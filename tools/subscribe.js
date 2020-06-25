const tsNats = require('ts-nats');

const natsConfig = {
  maxReconnectAttempts: -1,
  pingInterval: 15 * 1000,
  reconnectTimeWait: 1000,
  payload: tsNats.Payload.JSON,
  url: 'tls://cps.transnexus.com:4222',
  userCreds: `${__dirname.replace(/\/tools$/, '')}/user.creds`,
};

tsNats.connect(natsConfig).then(natsClient => {
  natsClient.on('error', console.error);
  natsClient.on('subscribe', () => console.log('Subscribed. Listening...'));

  natsClient.once('connect', async () => {
    await natsClient.subscribe('>', async (err, msg) => {
      if (err) {
        console.error(err);
      } else {
        console.log(`Subject: ${msg.subject}`);
        console.log('Message:');
        console.log(JSON.stringify(msg.data, null, 2));
        console.log('');
      }
    });
  });
}).catch(console.error);
