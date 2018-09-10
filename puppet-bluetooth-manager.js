const pull = require('pull-stream');
const Pushable = require('pull-pushable');

// Available as a built-in module in the nodejs environment
// see https://code.janeasystems.com/nodejs-mobile/getting-started-react-native
const rn_bridge = require('rn-bridge');

function makeManager () {

  // A map of remote device mac address to the duplex stream for reading data data
  // from (the source) and sending data to (the sink)
  const connections = {

  };

  // A map of devices we're awaiting an outgoing connection for. Key: device address,
  // value: errBack to give the connection.
  const awaitingConnection = {

  };

  let onIncomingConnection = null;

  function onConnect(params) {
    console.log("puppet: incoming connection");
    console.log(params);

    const deviceAddress = params.remoteAddress;

    // Source: reading from the remote device
    // Sink: writing to the remote device
    const duplexStream = {
      source: Pushable(),
      sink: pull.drain( (msg) => {

        var bridgeMsg = {
          type: "write",
          params: {
            // the data is a byte array so encode as a base64 string to send over bridge
            data: msg.toString('base64'),
            remoteAddress: deviceAddress
          }
        }

        rn_bridge.channel.send(JSON.stringify(bridgeMsg));
      })
    }

    connections[deviceAddress] = duplexStream;

    if (onIncomingConnection && params.isIncoming) {
      // Pass the duplex stream to multiserv via the callback that was given
      // to us in our 'server' function implementation
      onIncomingConnection(null, duplexStream);
    } else {
      const awaiting = awaitingConnection[params.remoteAddress];
      if (!awaiting) {
        console.log("Unexpectedly got a connection to a device we were not waiting on.");
      }

      connections[deviceAddress] = duplexStream;
      awaiting(null, duplexStream);

      delete awaitingConnection[deviceAddress];
    }
  }

  function onConnectionFailed(params) {
    console.log("puppet: failed connection: " + params.remoteAddress);

    const deviceAddress = params.remoteAddress;
    const awaiting = awaitingConnection[deviceAddress];

    awaiting("Could not connect to bluetooth address: " + deviceAddress);

    delete awaitingConnection[deviceAddress];
  }

  function onConnectionLost(params) {
    console.log("puppet: connection lost");
    console.log(params);
    const deviceAddress = params.remoteAddress;

    const duplexStream = connections[deviceAddress];

    if (duplexStream) {
      // todo: is this enough to signal to multiserv to break the connection?
      duplexStream.source.end();
      delete connections[deviceAddress];
    }
  }

  function onDataRead(params) {
    const deviceAddress = params.remoteAddress;
    const data = params.data;

    const duplexStream = connections[deviceAddress];

    if (duplexStream) {
      // Decode data from base64 string to buffer
      duplexStream.source.push(Buffer.from(data, 'base64'));
    } else {
      console.log("Unexpectedly didn't find address in device map.")
    }

  }

  function listenForIncomingConnections(cb) {

    // We use this callback to handle back any duplex streams for incoming
    // connections.
    onIncomingConnection = cb;

    var bridgeMsg = {
      type: "listenIncoming",
      params: {}
    }

    rn_bridge.channel.send(JSON.stringify(bridgeMsg));
  }

  function connect(address, cb) {

    // Store that we're awaiting a connection event to come back over the bridge
    awaitingConnection[address] = cb;

    var bridgeMsg = {
      type: "connectTo",
      params: {
        remoteAddress: address
      }
    }

    rn_bridge.channel.send(JSON.stringify(bridgeMsg));
  }

  function listenForBridgeEvents() {

    rn_bridge.channel.on('message', (msg) => {
      var message = JSON.parse(msg);

      if (message.type === "connectionSuccess") {
        onConnect(message.params);
      } else if (message.type === "connectionLost") {
        onConnectionLost(message.params);
      } else if (message.type === "connectionFailed") {
        onConnectionFailed(message.params);
      }
      else if (message.type === "read") {
        onDataRead(message.params);
      }

    });
  }

  listenForBridgeEvents();

  return {
    connect,
    listenForIncomingConnections
  }

}

module.exports = makeManager;
