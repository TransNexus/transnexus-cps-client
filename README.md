# TransNexus CPS Client

TransNexus Call Placement Service (CPS) is a multi-tenanted publish/subscribe system used for receiving PASSporTs out-of-band.

The TransNexus CPS Client package includes:

- Tooling for managing an account with TransNexus CPS
- An application that subscribes to TransNexus CPS and logs all received PASSporTs
- An application that subscribes to TransNexus CPS and populates a local Redis database with received PASSporTs

## Quick Getting Started

1. Install Node.js - [https://nodejs.org/en/download/](https://nodejs.org/en/download/)
2. Download this repository
3. Install Node.js packages by running `npm install`
4. Register with TransNexus CPS by running `node tools/register.js` and supplying the request information
5. Test subscribing by running `node tools/subscribe.js` to see the subject of any messages you receive
6. Install Redis - [https://redis.io/download](https://redis.io/download)
7. Start the main client application by running `node index.js`

## Publishing PASSporTs

To publish a PASSporT, an HTTP POST must be made to the following URL:

`https://cps.transnexus.com/${destinationServiceProviderCode}/${destinationNumber}/${sourceServiceProviderCode}/${sourceNumber}`

`${destinationServiceProviderCode}` and `${sourceServiceProviderCode}` must be exactly 4 characters long and contain only uppercase letters and numbers. `${destinationNumber}` and `${sourceNumber}` must be between 7 and 15 characters long and contain only numbers.

The `Content-Type` header of the HTTP POST must be set to `application/passport`.

Each HTTP POST must contain between 1 and 3 PASSporTs in the body separated by newlines. The PASSporTs x5u must reference a certificate chain no more than 3 certificates long, which should not include the root certificate.

HTTP POSTs do not directly require authentication, however all PASSporTs in the HTTP POST are verified before being published. PASSporTs must be signed by a certificate that chains up to an STI-CA's root certificate.

A `400 Bad Request` response will be sent if there are any issues with the request. The response body will be as follows:

```json
{
  "code": 400,
  "message": "The specific issue will be described here"
}
```

A `201 Created` response will be sent after the provided PASSporTs are published. The response body will be as follows:

```json
{
  "code": 201,
  "message": "Message published"
}
```

## Subject and Message Format

Each HTTP POST will result in at most one message being published.

The subject of the message is constructed from the HTTP POST's path as follows:

`${destinationServiceProviderCode}.${destinationNumber}.${sourceServiceProviderCode}.${sourceNumber}`

The message will use the following format:

```json
{
  "ip": "${httpPostSourceIp}",
  "passports": [
    {
      "passport": "${passport1}",
      "certificates": [
        "${pemShakenCertificate}",
        "${pemIntermediateCertificate}",
        "${pemRootCertificate}"
      ]
    },
    {
      "passport": "${passport2}",
      "certificates": [
        "${pemShakenCertificate}",
        "${pemIntermediateCertificate}",
        "${pemRootCertificate}"
      ]
    }
  ]
}
```

## Subscribing

Subscribing to receive PASSporTs requires both authentication and authorization.

Authentication is performed using NKEYS and authentication is performed using JWTs.

To subscribe, a service provider must be registered with TransNexus CPS. Only service providers that are able to obtain a Service Provider Code (SPC) token from the STI-PA are able to register. The SPC provided during registration will be used as the service providers master SPC. Additional SPCs can be added after registering.

All messages with a subject `${destinationServiceProviderCode}` or `${sourceServiceProviderCode}` that matches one of the service providers SPCs will be delivered into the service providers account. Service providers can create users with permission to subscribe to all subjects or specific subjects.

The register script `tools/register.js` will create an account NKey, create user credentials (user NKey and user JWT), and register with TransNexus CPS.
