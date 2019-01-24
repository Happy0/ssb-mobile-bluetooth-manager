const net = require('net');
const toPull = require('stream-to-pull-stream');
const fs = require('fs');
const pull = require('pull-stream');

const Pushable = require('pull-pushable');
const pullJson = require('pull-json-doubleline');

const zip  = require('pull-zip')

const uuidv4 = require('uuid/v4');

const debug = require('debug')('ssb-mobile-bluetooth-manager');

const EventEmitter = require('events');

function makeManager (opts) {

  const bluetoothScanStateEmitter = new EventEmitter();

  if (!opts || !opts.socketFolderPath) {
    throw new Error("ssb-mobile-bluetooth-manager must be configured with a socketFolderPath option.");
  }

  if (!opts || !opts.myIdent) {
    throw new Error("ssb-mobile-bluetooth-manager must be configured with the myIdent option.")
  }

  const EVENT_STARTED_SCAN = "startedBluetoothScan";
  const EVENT_FOUND_BLUETOOTH_DEVICES = "btDevicesFound";
  const EVENT_FINISHED_FINDING_BLUETOOTH_DEVICES = "endedBluetoothScan";
  const EVENT_CHECKING_DEVICES = "checkingForScuttlebutt";
  const EVENT_ENDED_CHECKING = "endedChecking";

  const awaitingConnection = Pushable();
  const outgoingConnectionsEstablished = Pushable();
  const outgoingAddressEstablished = Pushable();

  const incomingConnectionEstablished = Pushable();
  const incomingAddressEstablished = Pushable();

  let controlSocketSource = Pushable();

  let awaitingDevicesCb = null;
  let awaitingDiscoverableResponse = null;
  let awaitingIsEnabledResponse = null;
  let onIncomingConnection = null;
  let awaitingOwnMacAddressResponse = null;

  let awaitingMetadata = {

  }

  var metadataServiceUUID = "b4721184-46dc-4314-b031-bf52c2b197f3";

  function connect(bluetoothAddress, cb) {
    debug("Attempting outgoing connection to bluetooth address: " + bluetoothAddress);

    awaitingConnection.push(cb);

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
        pull.asyncMap( (item, cb) => {
          // temporary workaround for issue with messages getting swallowed at the other side of the socket.
          setTimeout( () => cb(null, item), 1000)
        }),
        pullJson.stringify(),
        pull.map(logOutgoingCommand),
        duplexConnection.sink
      );

      // Receive and process commands from the control server
      pull(duplexConnection.source, pullJson.parse(), pull.drain(doCommand));

    }).listen(address);

    controlSocketEstablished = true;

    controlSocket.on('closed', function() {
      debug("Control socket closed");
    })

    debug("Created control socket");
  }

  function makeFullyEstablishConnectionsHandler() {

    // It's unpredictable when each of these things happen, but they do happen sequentially
    // within their stream, so we zip them together and do the necessary action when ready

    pull(
      zip(awaitingConnection, outgoingConnectionsEstablished, outgoingAddressEstablished),
      pull.drain( results => {

        let cb = results[0];
        let stream = results[1].stream;
        let connectionOutcome = results[2];

        let outgoingAddress = connectionOutcome.address;
        stream.address = outgoingAddress;

        if (connectionOutcome.success) {
          debug("Calling back multiserve with successful outgoing connection to " + outgoingAddress);
          cb(null, stream);
        } else {
          debug("Calling back with unsuccessful connection to multiserver for address: " + outgoingAddress)
          cb(new Error(connectionOutcome.failureReason));
        }
      })
    );

    pull(
      zip(incomingConnectionEstablished, incomingAddressEstablished),
      pull.drain(results => {
        let stream = results[0].stream;
        let address = results[1].address;

        stream.address = address;

        debug("Calling back to multiserve with incoming bluetooth connection from " + address);
        onIncomingConnection(null, stream);
      })
    )

  }

  function logOutgoingCommand(command) {
    debug("Sending outgoing command to control server");
    debug(command);

    return command;
  }

  function doCommand (command) {

    debug("Received command: ");
    debug(command);

    let commandName = command.command;

    if (commandName === "connected" && !command.arguments.isIncoming) {
      // The initial stream connection is just to the Unix socket. We don't know if that socket is proxying
      // the bluetooth connection successfully until we receive an event to tell us it's connected.

      var addr = "bt:" + command.arguments.remoteAddress.split(":").join("");
      debug("Setting outgoing stream address to " + addr);

      var result = {
        success: true,
        address: addr
      }

      outgoingAddressEstablished.push(result);
    } else if (commandName === "connected" && command.arguments.isIncoming) {
      var incomingAddr = "bt:" + command.arguments.remoteAddress.split(":").join("");
      debug("Setting incoming connection stream address to: " + incomingAddr);
      
      incomingAddressEstablished.push({
        address: incomingAddr
      });

    } else if (commandName === "connectionFailure" && !command.arguments.isIncoming) {
      var reason = command.arguments.reason;

      var result = {
        success: false,
        address: command.arguments.remoteAddress.split(":").join(""),
        failureReason: reason
      }
      
      outgoingAddressEstablished.push(result);

    } else if (commandName === "disconnected") {

    } else if (commandName === "discovered") {
      var currentTime = Date.now();
      var arguments = command.arguments;

      debug("Updating nearby source");
      debug(arguments);

      if (arguments.error === true) {
        awaitingDevicesCb(arguments, null);
      } else {
        var nearBy = {
          lastUpdate: currentTime,
          discovered: arguments.devices
        }

        bluetoothScanStateEmitter.emit(EVENT_FOUND_BLUETOOTH_DEVICES, nearBy);
        bluetoothScanStateEmitter.emit(EVENT_FINISHED_FINDING_BLUETOOTH_DEVICES);
  
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
      debug("bluetooth: Outgoing connection established proxy connection.")

      var item = {
        stream: logDuplexStreams(toPull.duplex(stream))
      }

      outgoingConnectionsEstablished.push(item);

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

    var server = net.createServer(function (incomingStream) {

      // We only call back with the connection when we later receive the address over the control
      // bridge. See the 'onCommand' function.
      
      incomingConnectionEstablished.push({
        stream: logDuplexStreams( toPull.duplex(incomingStream) )
      })

    }).listen(socket);

    server.on('close', function (e) {
      debug("bt_bridge socket closed: " + e);
    });

    started = true;
    
    return function () {
      debug("Server close?");
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
          debug("getValidAddresses count: " + count);
    
          if (!err) {
            debug(device.remoteAddress + " is available for scuttlebutt bluetooth connections");
            device.id = res.id;
            results.push(device);
          }
    
          if (count === devices.length) {
            debug("Calling back (get valid addresses)...");
            debug("Valid addresses:");
            debug(results);

            bluetoothScanStateEmitter.emit(EVENT_CHECKING_DEVICES, {
              "checked": count,
              "total": devices.length,
              "discovered": results,
              "found": results.length,
              "remaining": (devices.length - count),
              "lastUpdate": Date.now()
            });

            cb(null, {
              "discovered": results,
              "lastUpdate": Date.now()
            });
          } else {
            bluetoothScanStateEmitter.emit(EVENT_CHECKING_DEVICES, {
              "checked": count,
              "total": devices.length,
              "discovered": results,
              "found": results.length,
              "remaining": (devices.length - count),
              "lastUpdate": Date.now()
            });
          }
    
        });
      }, num * 1000);
    })
  }

  function nearbyScuttlebuttDevices(refreshInterval) {
    return pull(
      nearbyDevices(refreshInterval),
      pull.asyncMap( (result, cb) => {

        debug("Nearby bluetooth devices.");
        debug(result);

        getValidAddresses(result.discovered, cb)
      }),
      pull.map(result => {
        bluetoothScanStateEmitter.emit(EVENT_ENDED_CHECKING, result);
        return result;
      })
    )
  }

  function nearbyDevices(refreshInterval) {

    return pull(
      pull.infinite(),
      pull.asyncMap((next, cb) => {
        setTimeout(() => {
          bluetoothScanStateEmitter.emit(EVENT_STARTED_SCAN);
          getLatestNearbyDevices(cb)
        }, refreshInterval)
      })
    )
  }

  function makeDeviceDiscoverable(forTime, cb) {
    debug("Making device discoverable");



    if (awaitingDiscoverableResponse != null) {
      cb(
        {
          "error": true,
          "errorCode": "alreadyInProgress",
          "description": "Already requesting to make device discoverable."
        }
      )
    } else {
      awaitingDiscoverableResponse = (err, result) => {

        if (err) {
          cb(new Error(err.description), null);
        } else {

          var payload = {
            "id": opts.myIdent
          };

          // The service should stop when the device is no longer discoverable
          var serviceNeededForSeconds = Math.ceil((result.discoverableUntil - Date.now()) / 1000);

          // Only start the metadata service once the device is discoverable
          controlSocketSource.push({
            "command": "startMetadataService",
            "arguments": {
              "serviceName": "scuttlebuttMetadata",
              "service": metadataServiceUUID,
              "payload": payload,
              "timeSeconds": serviceNeededForSeconds
            }
          });

          cb(null, result);
        }

      };

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

  function bluetoothScanState() {

    var source = Pushable(function (closed) {
      bluetoothScanStateEmitter.removeListener(onScanStarted);
      bluetoothScanStateEmitter.removeListener(onBtDevicesFound);
      bluetoothScanStateEmitter.removeListener(onFinishedFindingBluetoothDevices);
      bluetoothScanStateEmitter.removeListener(onCheckingDevices);
      bluetoothScanStateEmitter.removeListener(onFinishedCheckingDevices);
    });

    function onScanStarted()  {
      var event = {
        "state": EVENT_STARTED_SCAN
      }

      source.push(event);
    };

    function onBtDevicesFound (devices) {
      var event = {
        "state": EVENT_FOUND_BLUETOOTH_DEVICES,
        "update": devices
      }

      source.push(event);
    }

    function onFinishedFindingBluetoothDevices() {
      var event = {
        "state": EVENT_FINISHED_FINDING_BLUETOOTH_DEVICES
      }

      source.push(event);
    }

    function onCheckingDevices (update) {
      var event = {
        "state": EVENT_CHECKING_DEVICES,
        "update": update
      }

      source.push(event);
    }

    function onFinishedCheckingDevices() {
      var event = {
        "state": EVENT_ENDED_CHECKING
      }

      source.push(event);
    }

    bluetoothScanStateEmitter.on(EVENT_STARTED_SCAN, onScanStarted);
    bluetoothScanStateEmitter.on(EVENT_FOUND_BLUETOOTH_DEVICES, onBtDevicesFound);
    bluetoothScanStateEmitter.on(EVENT_FINISHED_FINDING_BLUETOOTH_DEVICES, onFinishedFindingBluetoothDevices);
    bluetoothScanStateEmitter.on(EVENT_CHECKING_DEVICES, onCheckingDevices);
    bluetoothScanStateEmitter.on(EVENT_ENDED_CHECKING, onFinishedCheckingDevices);

    return source;    
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

  /**
   * If 'opts.logStreams' is true, logs out incoming and outgoing data streams.
   * @param {} duplexStream 
   */
  function logDuplexStreams(duplexStream) {
    if (!opts.logStreams) {
      return duplexStream;
    } else {

      duplexStream.source = pull(duplexStream.source, pull.map(
        buff => {
          debug( "[source] " + buff.toString() )
          return buff;
        }
      ));

      duplexStream.sink = pull(
        pull.map(outgoingBuff => {
          debug( "[sink] " + outgoingBuff.toString() )
          return outgoingBuff;
        }),
        duplexStream.sink
      )

      return duplexStream;
    }
  }


  listenForOutgoingEstablished();
  makeControlSocket();
  makeFullyEstablishConnectionsHandler();

  return {
    connect,
    listenForIncomingConnections,
    nearbyDevices,
    bluetoothScanState,
    nearbyScuttlebuttDevices,
    makeDeviceDiscoverable,
    getMetadataForDevice,
    isEnabled,
    getOwnMacAddress
  }

}

module.exports = makeManager;
