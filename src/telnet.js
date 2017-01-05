'use strict';

var EventEmitter = require('events'),
    net = require('net');

// see: arpa/telnet.h
const IAC     = 255;
const DONT    = 254;
const DO      = 253;
const WONT    = 252;
const WILL    = 251;
const SB      = 250;
const SE      = 240;

const OPT_ECHO = 1;

/**
 * The following is an intentionally dismissive telnet parser,
 * it basically ignores anything the client tells it to do. Its
 * only purpose is to know how to parse negotiations and swallow
 * them. It can, however, issue commands such as toggling echo
 */
class TelnetStream extends EventEmitter
{
  constructor (opts) {
    super();
    this.isTTY = true;
    this.env = {};
    this.stream = null;
    this.maxInputLength = opts.maxInputLength || 512;
    this.echoing = true;
  };

  get readable () {
    return this.stream.readable;
  }

  get writable () {
    return this.stream.writable;
  }

  end (string, enc) {
    this.stream.end(string, enc);
  };

  write (data, encoding) {
    if (!Buffer.isBuffer(data)) {
      data = new Buffer(data, encoding);
    }

    // escape IACs by duplicating
    let iacs = 0;
    for (const val of data.values()) {
      if (val === IAC) {
        iacs++;
      }
    }

    if (iacs) {
      let b = new Buffer(data.length + iacs);
      for (let i = 0, j = 0; i < data.length; i++) {
        b[j++] = data[i];
        if (data[i] === IAC) {
          b[j++] = IAC;
        }
      }
    }

    try {
      if (!this.stream.ended && !this.stream.finished) {
        this.stream.write(data);
      }
    } catch (e) {
      console.log(e);
    }
  }

  setEncoding (encoding) {
    this.stream.setEncoding(encoding);
  }

  pause () {
    this.stream.pause();
  }

  resume () {
    this.stream.resume();
  }

  destroy () {
    this.stream.destroy();
  }

  /**
   * Execute a telnet command
   * @param {number}       willingness DO/DONT/WILL/WONT
   * @param {number|Array} command     Option to do/don't do or subsequence as array
   */
  telnetCommand (willingness, command) {
    let seq = [IAC, willingness];
    if (Array.isArray(command)) {
      seq.push.apply(seq, command);
    } else {
      seq.push(command);
    }

    this.stream.write(new Buffer(seq));
  }

  toggleEcho () {
    this.echoing = !this.echoing;
    this.telnetCommand(this.echoing ? WONT : WILL, OPT_ECHO);
    this.telnetCommand(DONT, OPT_ECHO);
  }

  attach (connection) {
    this.stream = connection;
    let inputbuf = new Buffer(this.maxInputLength);
    let inputlen = 0;

    connection.on('error', err => console.error('Telnet Stream Error: ', err));

    connection.on('data', (databuf) => {
      databuf.copy(inputbuf, inputlen);
      inputlen += databuf.length;

      if (!databuf.toString().match(/[\r\n]/)) {
        return;
      }

      this.input(inputbuf.slice(0, inputlen));
      inputbuf = new Buffer(this.maxInputLength);
      inputlen = 0;
    });

    connection.on('close', _ => {
      this.emit('close');
    });
  }

  /**
   * Parse telnet input stream, swallowing any negotiations
   * and emitting clean, fresh data
   *
   * @param {Buffer} inputbuf
   */
  input (inputbuf) {
    // strip any negotiations
    let cleanbuf = Buffer.alloc(inputbuf.length);
    let i = 0;
    let cleanlen = 0;
    let inSB = false;
    while (i < inputbuf.length) {
      if (inputbuf[i] !== IAC && !inSB) {
        cleanbuf[cleanlen++] = inputbuf[i++];
        continue;
      }

      // We don't actually negotiate, we don't care what the clients will or wont do
      // so just swallow everything inside an IAC sequence
      // i += (number of bytes including IAC)
      const cmd = inputbuf[i + 1];
      switch (cmd) {
        case WILL:
        case WONT:
        case DO:
        case DONT:
          i += 3;
          break;
        case SB:
          // swallow subnegotiations
          inSB = true;
          i += 2;
          let sublen = 0;
          while (inputbuf[i++] !== SE) {sublen++;}
          break;
        default:
          i += 2;
          break;
      }
    }

    this.emit('data', cleanbuf.slice(0, cleanlen - 1));
  }
}

class TelnetServer
{
  /**
   * @param {object}   streamOpts options for the stream @see TelnetStream
   * @param {function} listener   connected callback
   */
  constructor (streamOpts, listener) {
    this.netServer = net.createServer({}, (connection) => {
      var stream = new TelnetStream(streamOpts);
      stream.attach(connection);
      this.netServer.emit('connected', stream);
    });

    this.netServer.on('connected', listener);
    this.netServer.on('error', error => {
      console.error('Error: ', error);
      console.error('Stack Trace: ', error.stack);
    });

    this.netServer.on('uncaughtException', error => {
      console.error('Uncaught Error: ', error);
      console.error('Stack Trace: ', error.stack);
    });
  }
}

exports.TelnetServer = TelnetServer;

// vim:ts=2:sw=2:et:
