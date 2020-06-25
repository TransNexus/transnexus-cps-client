const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const nkeys = require('ts-nkeys');
const prompt = require('prompt');

const schema = {
  properties: {
    masterServiceProviderCode: {
      description: 'Enter your master service provider code',
      type: 'string',
      pattern: /^[A-Z0-9]{4}$/,
      message: 'Must be exactly 4 characters long and only contain uppercase letters and numbers',
      required: true,
    },
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

prompt.message = '';
prompt.colors = false;

prompt.start();

prompt.get(schema, async (err, config) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }

  console.log('Adding service provider code, this can take a minute, please wait...');

  const masterServiceProviderCode = config.masterServiceProviderCode;
  const serviceProviderCode = config.serviceProviderCode;
  const paUserId = config.paUserId;
  const paPassword = config.paPassword;
  const staging = config.staging === 'yes';

  const accountNkeyFilePath = `${__dirname.replace(/\/tools$/, '')}/account.nk`;

  const timestamp = Math.floor(Date.now() / 1000);

  let accountNkeyFile;
  try {
    accountNkeyFile = await fs.promises.readFile(accountNkeyFilePath);
  } catch (err) {
    console.error(`Unable to read account seed from ${accountNkeyFilePath}`);
    process.exit(1);
  }

  const accountNkey = nkeys.fromSeed(accountNkeyFile);
  const accountPublicKey = accountNkey.getPublicKey().toString('utf8');

  const fingerprintData = JSON.stringify({
    accountPublicKey: accountPublicKey,
    action: 'addServiceProviderCode',
    masterServiceProviderCode: masterServiceProviderCode,
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

  const { data: token } = await axios.post(`https://authenticate-api${staging ? '-stg' : ''}.iconectiv.com/api/v1/account/${masterServiceProviderCode}/token/`, {
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
    action: 'addServiceProviderCode',
    masterServiceProviderCode: masterServiceProviderCode,
    serviceProviderCode: serviceProviderCode,
    spcToken: token.token,
    timestamp: timestamp,
  });

  const signature = accountNkey.sign(Buffer.from(signatureData, 'utf8')).toString('hex');

  try {
    await axios.post('https://cps.transnexus.com/v1/addServiceProviderCode', {
      accountPublicKey: accountPublicKey,
      masterServiceProviderCode: masterServiceProviderCode,
      serviceProviderCode: serviceProviderCode,
      signature: signature,
      spcToken: token.token,
      timestamp: timestamp,
    });
  } catch (err) {
    console.error(`Unable to add service provider code, recieved "${err.response.data.message}"`);
    process.exit(1);
  }

  console.log(`Successfully added service provider code ${serviceProviderCode}.`);
});
