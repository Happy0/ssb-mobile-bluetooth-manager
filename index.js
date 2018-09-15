const pull = require('pull-stream');

const Pushable = require('pull-pushable');
const WebSocket = require('ws');

const rn_bridge = require('rn-bridge');
const Abortable = require('pull-abortable');

function makeManager () {

  function connect(address, cb) {

    console.log("Attempting outgoing ws connection");

    var pushable = Pushable();

    var ws = new WebSocket("ws://localhost:5666");

    var duplexStream = null;
    var abortable = Abortable();

    ws.on('open', function (event) {

      // Tell the websocket bridge where to connect
      ws.send(address);

      duplexStream = {
        source: pushable,
        sink: createWebsocketSink(ws, abortable)
      };

      console.dir(duplexStream);

      cb(null, duplexStream)
    });

    ws.on('message', function(data) {
      console.log(Buffer.from(data, 'base64').toString());

      pushable.push(Buffer.from(data, 'base64'));
    })

    ws.on('error', function() {
      console.log("connection ended with error to: " + address);
      duplexStream.source.end();
      abortable.abort();
    });


    ws.on('close', function() {
      console.log("connection closed to: " + address);

      duplexStream.source.end();
      abortable.abort();
    });

    return function () {
      console.log("todo")
    }

  }

  function listenForIncomingConnections(onConnection) {

    const wss = new WebSocket.Server({ port: 5667 });

    wss.on('connection', function connection(ws) {

      var abortable = Abortable();

      var source = Pushable();
      var sink = createWebsocketSink(ws, abortable);

      ws.on('message', function incoming(message) {
        source.push(Buffer.from(message, 'base64'));
      });

      ws.on('close', function() {  
        duplexStream.source.end();
        abortable.abort();
      });
    
      onConnection(null, {
        source: source,
        sink: sink
      })
    });

    var bridgeMsg = {
      type: "listenIncoming",
      params: {}
    }

    rn_bridge.channel.send(JSON.stringify(bridgeMsg));
    
  }

  function createWebsocketSink(ws, abortable) {
  
    return pull(
      abortable,
      pull.map(buf => buf.toString('base64')),
      pull.drain(msg => {

        try {
          ws.send(msg)
        } catch (error) {
          console.log(error);
          abortable.abort();

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
