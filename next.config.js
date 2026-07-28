/** @type {import('next').NextConfig} */
const nextConfig = {
  // unzipper's S3 support pulls in an optional @aws-sdk/client-s3 require that
  // we never use; keep it out of the webpack bundle and require()'d natively
  // at runtime instead, so the build doesn't fail resolving it.
  experimental: {
    serverComponentsExternalPackages: ["unzipper"],
  },
};

module.exports = nextConfig;
