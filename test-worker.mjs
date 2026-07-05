import { AwsClient } from 'aws4fetch';

export default {
  async fetch(req, env) {
    const results = [];
    function log(msg) { results.push(msg); }

    const cfg = {
      endpoint: env.S3_ENDPOINT,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      region: env.S3_REGION || 'auto',
      bucket: env.S3_BUCKET,
    };

    log(`1. Env: region=${cfg.region}, bucket=${cfg.bucket}, endpoint=${cfg.endpoint?.slice(0,25)}`);

    try {
      const client = new AwsClient({
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
        service: 's3',
        region: cfg.region,
      });

      log('2. Client created');

      const url = `${cfg.endpoint}/${cfg.bucket}?max-keys=1`;
      log(`3. Fetching: ${url}`);

      const res = await client.fetch(url, { method: 'GET', redirect: 'manual' });
      log(`4. Status: ${res.status}`);
      
      const headers = [...res.headers.entries()].slice(0, 8);
      log(`5. Headers: ${JSON.stringify(headers)}`);
      
      if (!res.ok) {
        const body = await res.text();
        log(`6. Body: ${body.slice(0, 300)}`);
      } else {
        log('6. OK!');
      }

      // 测试 PUT
      log('7. Testing PUT...');
      const putRes = await client.fetch(`${cfg.endpoint}/${cfg.bucket}/_test_diag.json`, {
        method: 'PUT',
        body: JSON.stringify({ diag: true }),
        headers: { 'Content-Type': 'application/json' },
        redirect: 'manual',
      });
      log(`8. PUT status: ${putRes.status}`);

    } catch(e) {
      log(`ERROR: ${e.message}`);
      log(`Stack: ${e.stack?.slice(0,200)}`);
    }

    return new Response(results.join('\n'), {
      headers: { 'content-type': 'text/plain;charset=utf-8' },
    });
  }
};
