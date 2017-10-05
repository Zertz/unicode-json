#!/usr/bin/env node
//

var fs = require('fs')
var path = require('path')
var https = require('https')
var readline = require('readline')

// http://www.ksu.ru/eng/departments/ktk/test/perl/lib/unicode/UCDFF301.html
var keys = [
  'value',
  'name',
  'category',
  'class',
  'bidirectional_category',
  'mapping',
  'decimal_digit_value',
  'digit_value',
  'numeric_value',
  'mirrored',
  'unicode_name',
  'comment',
  'uppercase_mapping',
  'lowercase_mapping',
  'titlecase_mapping'
]

var systemfiles = [
  '/usr/share/unicode/UnicodeData.txt', // debian
  '/usr/share/unicode-data/UnicodeData.txt', // gentoo
  '/usr/share/unicode/ucd/UnicodeData.txt', // redhat, unicode-ucd package
  process.env.NODE_UNICODETABLE_UNICODEDATA_TXT || 'UnicodeData.txt' // manually downloaded
]

var unicodedatafile = {
  scheme: 'https',
  host: 'unicode.org',
  path: '/Public/UNIDATA/UnicodeData.txt',
  method: 'GET',
  port: 80
}

var proxyServer = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy

// based on https://github.com/mathiasbynens/jsesc
function escape (charValue) {
  var hexadecimal = charValue.replace(/^0*/, '') // is already in hexadecimal
  var longhand = hexadecimal.length > 2
  return '\\' + (longhand ? 'u' : 'x') + ('0000' + hexadecimal).slice(longhand ? -4 : -2)
}

function stringify (key, value) {
  return '"' + key + '"' + ':' + JSON.stringify(value)
}

function readFile (successCb, errorCb) {
  var systemfile
  var sysfiles = systemfiles.slice()
  var tryReading = function (success, error) {
    systemfile = sysfiles.shift()

    if (!systemfile) {
      return errorCb()
    }

    console.info('try to read file %s…', systemfile)

    fs.access(systemfile, fs.constants.R_OK, function (err) {
      if (err) {
        if (err.code === 'ENOENT') {
          console.error('%s not found.', systemfile)
          return tryReading(successCb, errorCb)
        }

        throw err
      }

      console.info('parsing…')

      var data = {}

      var rl = readline.createInterface({
        input: fs.createReadStream(systemfile, {
          encoding: 'utf8'
        })
      })

      rl.on('line', function (line) {
        var char = {}
        var values = line.toString().split(';')

        for (var i = 0, length = keys.length; i < length; i++) {
          char[keys[i]] = values[i]
        }

        char.symbol = escape(char.value)

        var v = parseInt(char.value, 16)
        var c = char.category

        if (!data[c]) {
          data[c] = fs.createWriteStream(path.join(__dirname, 'category', c + '.json'), {
            encoding: 'utf8'
          })

          data[c].on('drain', function () {
            rl.resume()
          })

          console.log('saving data as %s.js…', c)

          if (data[c].write('{' + stringify(v, char))) {
            rl.resume()
          }

          rl.pause()
        } else if (!data[c].write(',' + stringify(v, char))) {
          rl.pause()
        }
      })

      rl.on('close', function () {
        var files = Object.keys(data).length

        for (var key in data) {
          data[key].end('}')
          data[key].once('finish', function () {
            if (--files === 0) {
              successCb()
            }
          })
        }
      })
    })
  }

  tryReading(successCb, errorCb)
}

function downloadFile (callback) {
  var timeouthandle = null
  console.info('%s %s://%s:%d%s', unicodedatafile.method, unicodedatafile.scheme, unicodedatafile.host, unicodedatafile.port, unicodedatafile.path)

  if (proxyServer) {
    var proxyVars = proxyServer.match(/^([^:/]*:[/]{2})?([^:/]+)(:([0-9]+))?/i)

    console.info('Proxy server detected, using proxy settings to download (%s)', proxyServer)

    unicodedatafile.path = unicodedatafile.scheme + '://' + unicodedatafile.host + ':' + unicodedatafile.port + unicodedatafile.path
    unicodedatafile.headers = {
      Host: unicodedatafile.host
    }
    unicodedatafile.host = proxyVars[2]
    unicodedatafile.port = proxyVars[4]
  }

  var dst = 'UnicodeData.txt'

  https.get(unicodedatafile, function (res) {
    console.log('fetching…')

    // stop timeout couting
    if (timeouthandle) {
      clearTimeout(timeouthandle)
    }

    var file = fs.createWriteStream(dst)

    res.setEncoding('utf8')
    res.pipe(file)

    file.on('finish', function () {
      file.close(function () {
        readFile(callback, callback)
      })
    })
  }).on('error', function (err) {
    console.error('Error while downloading %s: %s', path.basename(unicodedatafile.path), err)
    console.log('Please download file manually, put it next to the install.js file and run `node install.js` again.')
    fs.unlink(dst)
    callback(1) // eslint-disable-line
  })

  timeouthandle = setTimeout(function () {
    console.error('request timed out.')
    callback(1) // eslint-disable-line
  }, 30 * 1000)
}

// run
if (!module.parent) { // not required
  readFile(process.exit, function () {
    console.log('try to download…')
    downloadFile(process.exit)
  })
} else {
  module.exports = {
    escape: escape,
    stringify: stringify,
    read_file: readFile,
    download_file: downloadFile
  }
}
