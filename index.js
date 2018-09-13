const cat = require('pull-cat');
const pull = require('pull-stream');
const WS = require('pull-ws');
var Map = require('pull-stream/throughs/map');

function makeManager () {

  function connect(address, cb) {

    console.log("Attempting outgoing ws connection");
    var stream = WS.connect("ws://127.0.0.1:5666", {
      onConnect: function (err) {
        //ensure stream is a stream of node buffers
        stream.source = pull(stream.source, Map(Buffer))

        // Give the server the address, and then the rest of the stream.
        stream.sink = cat([
          pull.once(address),
          pull(pull.map((msg => btoa(msg)), stream.sink))
        ])

        cb(err, stream)
      }
    })

    return function () {
      stream.close(cb)
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
