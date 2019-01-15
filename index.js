const net = require('net');
const toPull = require('stream-to-pull-stream');
const fs = require('fs');
const pull = require('pull-stream');

const Pushable = require('pull-pushable');
const pullJson = require('pull-json-doubleline');

const uuidv4 = require('uuid/v4');

function makeManager (opts) {

  if (!opts.socketFolderPath) {
    throw new Error("ssb-mobile-bluetooth-manager must be configured with a socketFolderPath option.");
  }

  if (!opts.myIdent) {
    throw new Error("ssb-mobile-bluetooth-manager must be configured with the myIdent option.")
  }

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
  let awaitingDiscoverableResponse = null;
  let awaitingIsEnabledResponse = null;
  let lastIncomingStream = null;
  let onIncomingConnection = null;
  let awaitingOwnMacAddressResponse = null;

  let awaitingMetadata = {

  }

  var metadataServiceUUID = "b4721184-46dc-4314-b031-bf52c2b197f3";

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

    var address = opts.socketFolderPath + "/manyverse_bt_control.sock";

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

      var addr = "bt:" + command.arguments.remoteAddress;
      console.log("Setting outgoing stream address to " + addr);

      awaiting.stream.address = addr;
      awaiting.cb(null, awaiting.stream);
    } else if (commandName === "connected" && command.arguments.isIncoming) {
      var incomingAddr = "bt:" + command.arguments.remoteAddress;
      console.log("Setting incoming connection stream address to: " + incomingAddr);
      lastIncomingStream.address = incomingAddr;
      onIncomingConnection(null, lastIncomingStream);
    } else if (commandName === "connectionFailure" && !command.arguments.isIncoming) {
      var awaiting = awaitingConnection.shift();
      var reason = command.arguments.reason;
      
      awaiting.cb(new Error(reason), null);

    } else if (commandName === "disconnected") {

    } else if (commandName === "discovered") {
      var currentTime = Date.now();
      var arguments = command.arguments;

      console.log("Updating nearby source");
      console.log(arguments);

      if (arguments.error === true) {
        awaitingDevicesCb(arguments, null);
      } else {
        var nearBy = {
          lastUpdate: currentTime,
          discovered: arguments.devices
        }
  
        awaitingDevicesCb(null, nearBy);
      }
    
    } else if (commandName === "discoverable") {
      var arguments = command.arguments;
      if (arguments.error === true) {
        awaitingDiscoverableResponse(command.arguments);
      }
      else {
        awaitingDiscoverableResponse(null, command.arguments);
      }

      awaitingDiscoverableResponse = null;
    } else if (commandName === "isEnabled") {
      var arguments = command.arguments;
      awaitingIsEnabledResponse(null, arguments.enabled);
    } else if (commandName === "ownMacAddress") {
      var arguments = command.arguments;
      awaitingOwnMacAddressResponse(null, arguments.address);
    } else if (commandName === "getMetadata") {
      var arguments = command.arguments;

      var requestId = command.requestId;

      var cb = awaitingMetadata[requestId];

      if (arguments.error === true) {
        cb(arguments.error, null);
      } else {
        cb(null, arguments.metadata);
      }

      delete awaitingMetadata[requestId];
        
    }

  }

  function listenForOutgoingEstablished() {
    var address = opts.socketFolderPath + "/manyverse_bt_outgoing.sock";

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

    onIncomingConnection = onConnection;

    if(started) return
    
    var socket = opts.socketFolderPath + "/manyverse_bt_incoming.sock";
    try {
      fs.unlinkSync(socket);
    } catch (error) {
      
    }

    var server = net.createServer(function (stream) {

      // We only call back with the connection when we later receive the address over the control
      // bridge. See the 'onCommand' function.
      lastIncomingStream = toPull.duplex(stream);
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

  function getValidAddresses(devices, cb) {
  
    var results = [];
    var count = 0;
  
    devices.forEach( (device, num) => {
  
      // Leave some grace seconds so it's not complete spam..
      setTimeout( () => {
        getMetadataForDevice(device.remoteAddress, (err, res) => {
  
          count = count + 1;
    
          console.log("getValidAddresses count: " + count)
    
          if (!err) {
            console.log(device.remoteAddress + " is available for scuttlebutt bluetooth connections");
            device.id = res.id;
            results.push(device);
          }
    
          if (count === devices.length) {
            console.log("Calling back (get valid addresses)...");
            console.log("Valid addresses:");

            console.log(devices);
            cb(null, {
              "discovered": results,
              "lastUpdate": Date.now()
            });
          }
    
        });
      }, num * 2000);
    })
  }

  function nearbyScuttlebuttDevices(refreshInterval) {
    return pull(
      nearbyDevices(refreshInterval),
      pull.asyncMap( (result, cb) => {
        console.log("Result is? ");
        console.log(result);

        getValidAddresses(result.discovered, cb)
      })
    )
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

  function makeDeviceDiscoverable(forTime, cb) {
    console.log("Making device discoverable");

    if (awaitingDiscoverableResponse != null) {
      cb(
        {
          "error": true,
          "errorCode": "alreadyInProgress",
          "description": "Already requesting to make device discoverable."
        }
      )
    } else {
      awaitingDiscoverableResponse = cb;

      var payload = {
        "id": opts.myIdent
      };

      controlSocketSource.push({
        "command": "startMetadataService",
        "arguments": {
          "serviceName": "scuttlebuttMetadata",
          "service": metadataServiceUUID,
          "payload": payload,
          "timeSeconds": forTime - 10
        }
      })

      controlSocketSource.push({
        "command": "makeDiscoverable",
        "arguments": {
          "forTime": forTime    
        }
      });
    }
  }

  function isEnabled(cb) {
    if (awaitingIsEnabledResponse) {
      cb(
        {
          "error": true,
          "errorCode": "alreadyInProgress",
          "description": "Already awaiting 'isEnabled' response."
        }
      );
    } else {
      awaitingIsEnabledResponse = cb;

      controlSocketSource.push({
        "command": "isEnabled",
        "arguments": {

        }
      })
    }
  }

  function getMetadataForDevice(deviceMacAddress, cb) {
    var requestId = uuidv4();

    awaitingMetadata[requestId] = cb;

    controlSocketSource.push({
      "command": "getMetadata",
      "requestId": requestId,
      "arguments": {
        "remoteDevice": deviceMacAddress,
        "service": metadataServiceUUID
      }
    });

  }

  function getOwnMacAddress(cb) {
    if (awaitingOwnMacAddressResponse) {
      return makeError("alreadyAwaitingMacAddress", "Already awaiting 'ownMacAddress' response");
    } else {
      awaitingOwnMacAddressResponse = cb;

      controlSocketSource.push({
        "command": "ownMacAddress",
        "arguments": {

        }
      })

    }
  }

  function makeError(errorCode, description) {
    return {
        "error": true,
        "errorCode": errorCode,
        "description": description
      }
  }


  listenForOutgoingEstablished();
  makeControlSocket();

  return {
    connect,
    listenForIncomingConnections,
    nearbyDevices,
    nearbyScuttlebuttDevices,
    makeDeviceDiscoverable,
    getMetadataForDevice,
    isEnabled,
    getOwnMacAddress
  }

}

module.exports = makeManager;
