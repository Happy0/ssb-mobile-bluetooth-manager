const cat = require('pull-cat');
const pull = require('pull-stream');
const WS = require('pull-ws')

function makeManager () {

  function connect(address, cb) {

    var stream = WS.connect("ws://127.0.0.1:5667", {
      binaryType: opts.binaryType,
      onConnect: function (err) {
        //ensure stream is a stream of node buffers
        stream.source = pull(stream.source, Map(Buffer))

        // Give the server the address, and then the rest of the stream.
        stream.sink = cat([
          pull.once(address),
          stream.sink
        ])

        cb(err, stream)
      }
    })
    stream.address = addr

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
