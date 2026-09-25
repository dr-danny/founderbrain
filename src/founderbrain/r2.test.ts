import { test } from "node:test";
import assert from "node:assert/strict";
import { presignR2, presignS3 } from "./r2.ts";

test("SigV4 query presign matches the AWS published S3 example", () => {
  // docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
  const url = presignS3(
    {
      endpoint: "https://examplebucket.s3.amazonaws.com",
      bucket: "examplebucket",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    },
    "GET",
    "test.txt",
    86400,
    new Date("2013-05-24T00:00:00Z"),
    "us-east-1",
    "virtual",
  );
  assert.match(url, /X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404$/);
});

test("R2 presign is path-style on the account endpoint with region auto", () => {
  const url = new URL(
    presignR2(
      { endpoint: "https://acct.r2.cloudflarestorage.com", bucket: "media", accessKeyId: "k", secretAccessKey: "s" },
      "PUT",
      "ws/id/my file.png",
      900,
      new Date("2026-09-25T12:00:00Z"),
    ),
  );
  assert.equal(url.host, "acct.r2.cloudflarestorage.com");
  assert.equal(url.pathname, "/media/ws/id/my%20file.png");
  assert.equal(url.searchParams.get("X-Amz-Expires"), "900");
  assert.match(url.searchParams.get("X-Amz-Credential") ?? "", /^k\/20260925\/auto\/s3\/aws4_request$/);
});
