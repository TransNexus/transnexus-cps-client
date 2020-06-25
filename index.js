const ioredis = require('ioredis');
const tsNats = require('ts-nats');

const redisConfig = {
  dropBufferSupport: true,
  enableOfflineQueue: false,
  retryStrategy: () => 1000,
};

const natsConfig = {
  maxReconnectAttempts: -1,
  pingInterval: 15 * 1000,
  reconnectTimeWait: 1000,
  url: 'tls://cps.transnexus.com:4222',
  userCreds: `${__dirname}/user.creds`,
};

const redisClient = new ioredis(redisConfig);
redisClient.on('error', console.error);

redisClient.once('ready', async () => {
  const natsClient = await tsNats.connect(natsConfig);

  natsClient.on('error', console.error);
  natsClient.on('subscribe', () => console.log('Subscribed. Listening...'));

  natsClient.once('connect', async () => {
    await natsClient.subscribe('>', async (err, msg) => {
      if (err) {
        console.error(err);
      } else {
        try {
          const [
            /*destinationServiceProviderCode*/,
            destinationNumber,
            /*sourceServiceProviderCode*/,
            sourceNumber,
          ] = msg.subject.split('.');
          const key = `oob:${destinationNumber}:${sourceNumber}`;
          await redisClient.setex(key, 60, msg.data);
        } catch (err) {
          console.error(err);
        }
      }
    });
  });
});
