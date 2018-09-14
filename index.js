const cat = require('pull-cat');
const pull = require('pull-stream');

const Pushable = require('pull-pushable');

const WebSocket = require('ws');

function makeManager () {

  function connect(address, cb) {

    console.log("Attempting outgoing ws connection");

    var pushable = Pushable();

    var ws = new WebSocket("ws://localhost:5666");

    var duplexStream = null;

    ws.on('open', function (event) {

      // Tell the websocket bridge where to connect
      ws.send(address);

      duplexStream = {
        source: pushable,
        sink: createWebsocketSink(ws)
      };

      cb(null, duplexStream)
    });

    ws.on('message', function(data) {
      console.log(Buffer.from(data, 'base64').toString());

      pushable.push(Buffer.from(data, 'base64'));
    })

    ws.on('error', function() {
      console.log("connection ended with error to: " + address);
      duplexStream.source.end();
    });


    ws.on('close', function() {
      console.log("connection closed to: " + address);

      duplexStream.source.end();
    });

    return function () {
      console.log("todo")
    }

  }

  function listenForIncomingConnections(onConnection) {
    // todo
  }

  function createWebsocketSink(ws) {
  
    return pull(
      pull.map(buf => buf.toString('base64')), pull.drain(msg => {

        try {
          ws.send(msg)
        } catch (error) {
          console.log(error);

          // todo: how to abort sink / streams?
        }
      })
    )
  }

  return {
    connect,
    listenForIncomingConnections
  }

}

module.exports = makeManager;
