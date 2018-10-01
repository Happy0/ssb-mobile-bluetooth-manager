const pull = require('pull-stream');

const Pushable = require('pull-pushable');

const rn_bridge = require('rn-bridge');
const Abortable = require('pull-abortable');

const net = require('net');
const toPull = require('stream-to-pull-stream');

const abs = require('abstract-socket');

const fs = require('fs')

function makeManager () {

  function connect(bluetoothAddress, cb) {

    // Android only allows you to set up unix sockets in the abstract linux namespace. Addresses in the abstract linux namespace
    // begin with \0. The .net library doesn't handle these by default, so we use 'abstract-socket' which establishes the socket then
    // hands it to the usual nodejs net class internally.
    var address = "\0manyverse_bt_outgoing.sock";

    var stream = abs.connect(address, function () {
        console.log("Client connection to bridge for " + bluetoothAddress);
        stream.write(bluetoothAddress, 'utf8', () => cb(null, toPull.duplex(stream)));
      })
      .on('error', function (err) {
        cb(err)
      })

    return function () {
      stream.destroy()
      cb(new Error('multiserver.bt_bridge: aborted'))
}

  }

  // hax on double transform
  var started = false

  function listenForIncomingConnections(onConnection) {

    if(started) return
    
    var socket = "/data/data/se.manyver/files/manyverse_bt_incoming.sock";

    var server = net.createServer(function (stream) {
      onConnection(null, toPull.duplex(stream))
    }).listen(socket);

    server.on('error', function (e) {
      if (e.code == 'EADDRINUSE') {
        var clientSocket = new net.Socket()
        clientSocket.on('error', function(e) {
          if (e.code == 'ECONNREFUSED') {
            fs.unlinkSync(socket)
            server.listen(socket)
          }
        })

        clientSocket.connect({ path: socket }, function() {
          console.log("bt-bridge: someone else is listening on socket!")
        })
      } else {
        console.log("bt_bridge: " + e);
      }
    })

    server.on('close', function (e) {
      console.log("bt_bridge socket closed: " + e);
    });

    started = true;

    fs.chmodSync(socket, 0600)

    var bridgeMsg = {
      type: "listenIncoming",
      params: {}
    }

    rn_bridge.channel.send(JSON.stringify(bridgeMsg));
    
    return function () {
      console.log("Server close?");
      server.close()
    }
  }

  return {
    connect,
    listenForIncomingConnections
  }

}

module.exports = makeManager;
