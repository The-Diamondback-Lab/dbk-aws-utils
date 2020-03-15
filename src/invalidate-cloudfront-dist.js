const CloudFront = require('aws-sdk/clients/cloudfront')
const ACM = require('aws-sdk/clients/acm')

require('dotenv').config()

const creds = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
}

const cf = new CloudFront(creds)

/**
 * Generates a `ViewerCertificate` object (for use with creating CloudFront distributions)
 * by searching for a certificate in the ACM whose domain name matches the S3 bucket's name
 * (it is assumed that the S3 bucket name is a valid domain name)
 *
 * @param {strng} bucketName bucket name that's matched against a domain name
 * @returns {AWS.CloudFront.ViewerCertificate}
 */
async function getViewerCertificate(bucketName) {
  const acm = new ACM(creds)

  // List all certificates
  const certs = (await acm.listCertificates({
    CertificateStatuses: ['ISSUED']
  }).promise()).CertificateSummaryList

  // Get full details of certificates
  const detailedCerts = (await Promise.all(
    certs.map(cert =>
      acm.describeCertificate({ CertificateArn: cert.CertificateArn }).promise())))
    .map(x => x.Certificate)

  // Find certificate whose domain name matches bucket's name
  const ind = detailedCerts.findIndex(cert => cert.DomainName === bucketName)

  if (ind < 0) {
    console.log('Could not find matching ACM certificate, defaulting to CloudFront certificate')

    return {
      CloudFrontDefaultCertificate: true,
      MinimumProtocolVersion: 'TLSv1.1_2016',
      SSLSupportMethod: 'sni-only'
    }
  } else {
    console.log('Found matching ACM certificate')

    return {
      CloudFrontDefaultCertificate: false,
      ACMCertificateArn: certs[ind].CertificateArn,
      MinimumProtocolVersion: 'TLSv1.1_2016',
      SSLSupportMethod: 'sni-only'
    }
  }
}

/**
 * Invalidates all files served by the associated cloudfront distribution.
 *
 * The associated distribution is one that has an origin with an id matching the following format:
 *    `S3-Website-<bucketname>.s3-website.us-east-1.amazonaws.com`
 *
 * If the distribution could not be found, then one is created. If there is an ACM certificate
 * whose domain name exactly matches the bucket name, then the distribution uses this certificate
 * instead of the default CloudFront certificate.
 *
 * @param {string} bucketName name of the bucket, which is used in finding the associated cloudfront
 * distribution
 */
async function invalidateCloudfrontDistro(bucketName) {
  const s3SiteSuffix = 's3-website.us-east-1.amazonaws.com'

  const targetOriginDomainName = `${bucketName}.${s3SiteSuffix}`
  const targetOriginId = `S3-Website-${targetOriginDomainName}`

  // List all cloudfront distributions
  const distributions = (await cf.listDistributions().promise()).DistributionList.Items

  // Find the one that has an origin with an id that matches `targetOriginId`
  const dist = distributions.find(d =>
    d.Origins.Items.find(origin => origin.Id === targetOriginId) != null
  )

  if (dist != null) {
    console.log(`Found cloudfront distribution with origin id "${targetOriginId}"`)
    console.log('Invalidating all of its paths')

    // Remove all files from cache before they expire
    // Once invalidation is complete, causes the next visit on the page to fetch
    // new items from bucket
    await cf.createInvalidation({
      DistributionId: dist.Id,
      InvalidationBatch: {
        CallerReference: Date.now().toString(),
        Paths: {
          Quantity: 1,
          Items: ['/*']
        }
      }
    }).promise()

    console.log('Created invalidation')
  } else {
    console.log(`No cloudfront distribution found with origin id "${targetOriginId}"`)
    console.log('Creating a cloudfront distribution with such an origin')

    const ViewerCertificate = await getViewerCertificate(bucketName)

    await cf.createDistribution({
      DistributionConfig: {
        CallerReference: Date.now().toString(),
        Comment: '',
        DefaultCacheBehavior: {
          ForwardedValues: {
            Cookies: {
              Forward: 'none'
            },
            QueryString: false
          },
          MinTTL: 0,
          MaxTTL: 31536000,
          DefaultTTL: 86400,
          TargetOriginId: null, /* TODO */
          TrustedSigners: {
            Enabled: false,
            Quantity: 0
          },
          ViewerProtocolPolicy: 'redirect-to-https',
          Compress: true,
          AllowedMethods: {
            Quantity: 2,
            Items: ['GET', 'HEAD'],
            CachedMethods: {
              Quantity: 2,
              Items: ['GET', 'HEAD']
            }
          }
        },
        Enabled: true,
        Origins: {
          Quantity: 1,
          Items: [
            {
              DomainName: targetOriginDomainName,
              Id: targetOriginId
            }
          ]
        },
        Aliases: {
          Quantity: 1,
          Items: [bucketName]
        },
        HttpVersion: 'http2',
        IsIPV6Enabled: true,
        PriceClass: 'PriceClass_All',
        ViewerCertificate
      }
    }).promise()

    console.log('Created cloudfront distribution')
  }
}

module.exports = invalidateCloudfrontDistro
