const net = require('net');
const toPull = require('stream-to-pull-stream');
const fs = require('fs');
const pull = require('pull-stream');

const Pushable = require('pull-pushable');
const pullJson = require('pull-json-doubleline')

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

  let controlSocketSource = Pushable();

  let awaitingDevicesCb = null;

  function connect(bluetoothAddress, cb) {
    console.log("Attempting outgoing connection to bluetooth address: " + bluetoothAddress);

    awaitingConnection.push({
      address: bluetoothAddress,
      cb
    });

    // Tell the native android code to make the outgoing bluetooth connection and then connect back
    // on the socket

    controlSocketSource.push({
      "command": "connect",
      "arguments": {
        "remoteAddress": bluetoothAddress
      }
    })
  
  }

  let controlSocketEstablished = false;

  function makeControlSocket() {
    if (controlSocketEstablished) return;

    var address = "/data/data/se.manyver/files/manyverse_bt_control.sock";

    try {
      fs.unlinkSync(address);
    } catch (error) {
    }

    var controlSocket = net.createServer(function(stream){

      var duplexConnection = toPull.duplex(stream);

      // Send commands to the control server
      pull(controlSocketSource, 
        pullJson.stringify(),
        pull.map(logOutgoingCommand),
        duplexConnection.sink
      );

      // Receive and process commands from the control server
      pull(duplexConnection.source, pullJson.parse(), pull.drain(doCommand));

    }).listen(address);

    controlSocketEstablished = true;

    controlSocket.on('closed', function() {
      console.log("Control socket closed");
    })

    console.log("Created control socket");
  }

  function logOutgoingCommand(command) {
    console.log("Sending outgoing command to control server");
    console.log(command);

    return command;
  }

  function doCommand (command) {

    console.log("Received command: ");
    console.dir(command);

    let commandName = command.command;

    if (commandName === "connected" && !command.arguments.isIncoming) {
      // The initial stream connection is just to the Unix socket. We don't know if that socket is proxying
      // the bluetooth connection successfully until we receive an event to tell us it's connected.
      var awaiting = awaitingConnection.shift();
      awaiting.cb(null, awaiting.stream);

    } else if (commandName === "connectionFailure") {
      var awaiting = awaitingConnection.shift();
      var reason = command.arguments.reason;
      
      awaiting.cb(new Error(reason), null);

    } else if (commandName === "disconnected") {

    } else if (commandName === "discovered") {
      var currentTime = Date.now();
      var arguments = command.arguments;

      console.log("Updating nearby source");
      console.log(arguments);

      var nearBy = {
        lastUpdate: currentTime,
        discovered: arguments.devices
      }

      awaitingDevicesCb(null, nearBy);
    }

  }

  function listenForOutgoingEstablished() {
    var address = "/data/data/se.manyver/files/manyverse_bt_outgoing.sock";

    try {
      fs.unlinkSync(address);
    } catch (error) {

    }

    var server = net.createServer(function(stream){
      console.log("bluetooth: Outgoing connection established proxy connection, adding to awaiting object.")

      awaitingConnection[0].stream = toPull.duplex(stream);
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

    server.on('close', function (e) {
      console.log("bt_bridge socket closed: " + e);
    });

    started = true;
    
    return function () {
      console.log("Server close?");
    }
  }

  function refreshNearbyDevices() {
    // Tell the native android code to discover nearby devices. When it responds, we'll update the
    // 'nearBy devices' pull-stream source

    controlSocketSource.push({
      "command": "discoverDevices",
      "arguments": {
        
      }
    });
  }

  function getLatestNearbyDevices(cb) {
    awaitingDevicesCb = cb;

    refreshNearbyDevices();
  }

  function nearbyDevices(refreshInterval) {

    return pull(
      pull.infinite(),
      pull.asyncMap((next, cb) => {
        setTimeout(() => {
          getLatestNearbyDevices(cb)
        }, refreshInterval)
      })
    )
  }

  function makeDeviceDiscoverable(forTime) {
    console.log("Making device discoverable");

    controlSocketSource.push({
      "command": "makeDiscoverable",
      "arguments": {
        "forTime": forTime    
      }
    });
  }

  listenForOutgoingEstablished();
  makeControlSocket();

  return {
    connect,
    listenForIncomingConnections,
    nearbyDevices,
    makeDeviceDiscoverable
  }

}

module.exports = makeManager;
