const cat = require('pull-cat');
const pull = require('pull-stream');

const Pushable = require('pull-pushable');

const WebSocket = require('ws');

function makeManager () {

  function connect(address, cb) {

    console.log("Attempting outgoing ws connection");

    var pushable = Pushable();

    var ws = new WebSocket("ws://localhost:5666");

    ws.on('open', function (event) {

      // Tell the websocket bridge where to connect
      ws.send(address);

      var duplexStream = {
        source: pushable,
        sink: pull(pull.map(buf => buf.toString('base64')), pull.drain(msg => ws.send(msg)))
      };

      cb(null, duplexStream)
    });

    ws.on('message', function(data) {
      console.log("Incoming: " + data);
      pushable.push(Buffer.from(data, 'base64'));
    })

    return function () {
      console.log("todo")
    }

  }

  function listenForIncomingConnections(onConnection) {
    // todo
  }


  return {
    connect,
    listenForIncomingConnections
  }

}

module.exports = makeManager;
