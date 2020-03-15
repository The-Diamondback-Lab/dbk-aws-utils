const S3 = require('aws-sdk/clients/s3')
require('dotenv').config()

const s3 = new S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

/**
 * Creates S3 buckets configured as websites. The website's error and index documents will both
 * point to "index.html"
 *
 * @param {string} bucketName name of the bucket
 */
async function createWebsiteBucket(bucketName) {
  await s3.createBucket({
    Bucket: bucketName,
    ACL: 'public-read'
  }).promise()

  await s3.putBucketWebsite({
    Bucket: bucketName,
    WebsiteConfiguration: {
      ErrorDocument: {
        Key: 'index.html'
      },
      IndexDocument: {
        Suffix: 'index.html'
      }
    }
  }).promise()

  console.log(`Created bucket ${bucketName}`)
}

module.exports = createWebsiteBucket
