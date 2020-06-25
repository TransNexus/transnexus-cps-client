const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const nkeys = require('ts-nkeys');
const prompt = require('prompt');

const schema = {
  properties: {
    serviceProviderCode: {
      description: 'Enter your service provider code',
      type: 'string',
      pattern: /^[A-Z0-9]{4}$/,
      message: 'Must be exactly 4 characters long and only contain uppercase letters and numbers',
      required: true,
    },
    paUserId: {
      description: 'Enter your STI-PA user ID',
      type: 'string',
      message: 'Must be a non empty string',
      required: true,
    },
    paPassword: {
      description: 'Enter your STI-PA password',
      type: 'string',
      message: 'Must be a non empty string',
      hidden: true,
      replace: '*',
      required: true,
    },
    staging: {
      description: 'Are your credentials for the STI-PA staging environment? yes/no',
      type: 'string',
      pattern: /^yes|no$/,
      message: 'Must be yes or no',
      default: 'no',
    },
  },
};

function bufferToBase64Url(buffer) {
  return buffer.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

prompt.message = '';
prompt.colors = false;

prompt.start();

prompt.get(schema, async (err, config) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }

  console.log('Registering, this can take a minute, please wait...');

  const serviceProviderCode = config.serviceProviderCode;
  const paUserId = config.paUserId;
  const paPassword = config.paPassword;
  const staging = config.staging === 'yes';

  const accountNkeyFilePath = `${__dirname.replace(/\/tools$/, '')}/account.nk`;
  const userCredentialFilePath = `${__dirname.replace(/\/tools$/, '')}/user.creds`;

  const timestamp = Math.floor(Date.now() / 1000);

  const accountNkey = nkeys.createAccount();
  const accountPublicKey = accountNkey.getPublicKey().toString('utf8');
  const accountSeed = accountNkey.getSeed().toString('utf8');

  const userNkey = nkeys.createUser();
  const userPublicKey = userNkey.getPublicKey().toString('utf8');
  const userSeed = userNkey.getSeed().toString('utf8');

  const fingerprintData = JSON.stringify({
    accountPublicKey: accountPublicKey,
    action: 'register',
    serviceProviderCode: serviceProviderCode,
    timestamp: timestamp,
  });

  const hash = crypto.createHash('sha256').update(fingerprintData, 'utf8').digest('hex');
  const fingerprint = `SHA256 ${hash.toUpperCase().match(/.{1,2}/g).join(':')}`;

  const hexServiceProviderCode = Buffer.from(serviceProviderCode, 'utf8').toString('hex');
  const hexTkvalue = `3008A0061604${hexServiceProviderCode}`;
  const tkvalue = Buffer.from(hexTkvalue, 'hex').toString('base64');

  const { data: login } = await axios.post(`https://authenticate-api${staging ? '-stg' : ''}.iconectiv.com/api/v1/auth/login`, {
    userId: paUserId,
    password: paPassword,
  });
  if (!login.accessToken) {
    console.error(`Unable to login to SIT-PA, recieved "${login.message}"`);
    process.exit(1);
  }

  const { data: token } = await axios.post(`https://authenticate-api${staging ? '-stg' : ''}.iconectiv.com/api/v1/account/${serviceProviderCode}/token/`, {
    atc: {
      tktype: 'TNAuthList',
      tkvalue: tkvalue,
      ca: false,
      fingerprint: fingerprint,
    },
  }, {
    headers: {
      Authorization: login.accessToken,
    },
  });
  if (!token.token) {
    console.error(`Unable to request SPC token from SIT-PA, recieved "${token.message}"`);
    process.exit(1);
  }

  const signatureData = JSON.stringify({
    accountPublicKey: accountPublicKey,
    action: 'register',
    serviceProviderCode: serviceProviderCode,
    spcToken: token.token,
    timestamp: timestamp,
  });

  const signature = accountNkey.sign(Buffer.from(signatureData, 'utf8')).toString('hex');

  try {
    await axios.post('https://cps.transnexus.com/v1/register', {
      accountPublicKey: accountPublicKey,
      serviceProviderCode: serviceProviderCode,
      signature: signature,
      spcToken: token.token,
      timestamp: timestamp,
    });
  } catch (err) {
    console.error(`Unable to register, recieved "${err.response.data.message}"`);
    process.exit(1);
  }

  await fs.promises.writeFile(accountNkeyFilePath, accountSeed);

  console.log(`Account seed saved to ${accountNkeyFilePath}`);

  const jwtHeader = bufferToBase64Url(Buffer.from(JSON.stringify({
    typ: 'jwt',
    alg: 'ed25519',
  })));
  const jwtPayload = bufferToBase64Url(Buffer.from(JSON.stringify({
    jti: crypto.randomBytes(32).toString('hex').toUpperCase(),
    iat: timestamp,
    iss: accountPublicKey,
    sub: userPublicKey,
    type: 'user',
    nats: {
      pub: {
        deny: [
          '>',
        ],
      },
      sub: {
        allow: [
          `>`,
        ],
      },
    },
  })));
  const jwtSignature = bufferToBase64Url(accountNkey.sign(Buffer.from(jwtPayload, 'utf8')));
  const userJwt = `${jwtHeader}.${jwtPayload}.${jwtSignature}`;

  const userCredentialFileData = `-----BEGIN NATS USER JWT-----\n${userJwt}\n------END NATS USER JWT------\n-----BEGIN USER NKEY SEED-----\n${userSeed}\n------END USER NKEY SEED------\n`;
  await fs.promises.writeFile(userCredentialFilePath, userCredentialFileData);

  console.log(`User credentials saved to ${userCredentialFilePath}`);

  console.log(`Successfully registered service provider code ${serviceProviderCode}.`);
});
