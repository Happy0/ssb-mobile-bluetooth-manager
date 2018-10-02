const rn_bridge = require('rn-bridge');
const net = require('net');
const toPull = require('stream-to-pull-stream');
const fs = require('fs');

function makeManager () {

  /**
   * Android only allows unix socks in the Linux abstract namespace. Files have much better security,
   * so we create a socket here to tell us when an outgoing bluetooth connection has been established.
   * This isn't very elegant, but I couldn't get file based sockets working in android even with
   * with the support of native C code for creating the server socket then passing the descriptor to Java.
   * 
   * The outgoing connections are made synchronously, so the front of the list is the last connection
   * we're awaiting a response from. When we get an incoming connection, we dequeue the queue and callback
   * with the connection.
   * 
   * On a connection failure, an incoming connection on the unix socket is made then disconnected.
   */
  const awaitingConnection = [];

  function connect(bluetoothAddress, cb) {
    awaitingConnection.push(cb);

    // Tell the native android code to make the outgoing bluetooth connection and then connect back
    // on the socket
    var bridgeMsg = {
      type: "connectBt",
      params: {
        remoteAddress: bluetoothAddress
      }
    }

    console.log("bt: Asking to connect over bridge to " + bluetoothAddress);
    rn_bridge.channel.send(JSON.stringify(bridgeMsg));
  }

  function listenForOutgoingEstablished() {
    var address = "/data/data/se.manyver/files/manyverse_bt_outgoing.sock";

    try {
      fs.unlinkSync(address);
    } catch (error) {

    }

    var server = net.createServer(function(stream){
      console.log("bluetooth: Outgoing connection established, calling back.")
      var cb = awaitingConnection.shift();
      cb(null, toPull.duplex(stream));
    }).listen(address);
  }


  // For some reason, .server gets called twice...
  var started = false

  function listenForIncomingConnections(onConnection) {

    if(started) return
    
    var socket = "/data/data/se.manyver/files/manyverse_bt_incoming.sock";
    try {
      fs.unlinkSync(socket);
    } catch (error) {
      
    }

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

  listenForOutgoingEstablished();

  return {
    connect,
    listenForIncomingConnections
  }

}

module.exports = makeManager;
