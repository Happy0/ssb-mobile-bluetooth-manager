const pull = require('pull-stream');

const Pushable = require('pull-pushable');

const rn_bridge = require('rn-bridge');
const Abortable = require('pull-abortable');

const net = require('net');
const toPull = require('stream-to-pull-stream');

const fs = require('fs')

function makeManager () {

  function connect(address, cb) {

    var started = false;

    var socket = net.connect(
      "/data/data/se.manyver/files/manyverse_bt_outgoing.sock"
    ).on('connect', function () {
      if(started) return

      // Tell the other side of the bridge the bluetooth device to connect to.
      socket.write(address, () => {
        console.log("Making duplex stream.")
        cb(null, toPull.duplex(socket));
      });

    }).on('error', function (err) {
      console.log("err?", err)
      if(started) return
      started = true
      cb(err)
    });

    return function () {
      started = true
      socket.destroy();
      cb(new Error("multiserv bt bridge aborted."))
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
