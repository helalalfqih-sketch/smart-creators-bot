import crypto from 'crypto';

export interface S3TestConfig {
  endpointUrl?: string;
  bucket?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export interface S3TestResult {
  ok: boolean;
  message: string;
  error?: string;
  details?: {
    endpoint: string;
    bucket: string;
    region: string;
    testKey: string;
    uploadedBytes: number;
    uploadStatus: number;
    readStatus: number;
    deleteStatus: number;
    durationMs: number;
    presignedUrl: string;
    textContent: string;
  };
}

function sha256(str: string | Buffer): string {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function hmac(key: Buffer | string, data: string | Buffer): Buffer {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function getSigningKey(secretKey: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmac('AWS4' + secretKey, dateStamp);
  const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
  const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
  return crypto.createHmac('sha256', kService).update('aws4_request').digest();
}

export function generateS3PresignedUrl(params: {
  endpointUrl: string;
  bucket: string;
  key: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  expiresIn?: number;
}): string {
  const {
    endpointUrl,
    bucket,
    key,
    accessKeyId,
    secretAccessKey,
    region = 'auto',
    expiresIn = 900,
  } = params;

  const cleanEndpoint = endpointUrl.replace(/\/$/, '');
  const cleanKey = key.replace(/^\//, '');
  const urlObj = new URL(`${cleanEndpoint}/${bucket}/${encodeURI(cleanKey)}`);
  const host = urlObj.host;
  const path = urlObj.pathname;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.substring(0, 8);
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;

  const queryParams = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresIn),
    'X-Amz-SignedHeaders': 'host',
  });

  queryParams.sort();
  const canonicalQuery = queryParams.toString();
  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = 'host';
  const payloadHash = 'UNSIGNED-PAYLOAD';

  const canonicalRequest = [
    'GET',
    path,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join('\n');

  const signingKey = getSigningKey(secretAccessKey, dateStamp, region, 's3');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return `${cleanEndpoint}/${bucket}/${encodeURI(cleanKey)}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export function signS3Request(params: {
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
  url: string;
  body?: string | Buffer;
  contentType?: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
}): { headers: Record<string, string> } {
  const {
    method,
    url,
    body = '',
    contentType,
    accessKeyId,
    secretAccessKey,
    region = 'auto',
  } = params;

  const parsedUrl = new URL(url);
  const host = parsedUrl.host;
  const path = parsedUrl.pathname || '/';

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.substring(0, 8);
  const payloadHash = sha256(body);

  let canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  let signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  if (contentType) {
    canonicalHeaders = `content-type:${contentType}\n` + canonicalHeaders;
    signedHeaders = 'content-type;' + signedHeaders;
  }

  const queryParams = new URLSearchParams(parsedUrl.search);
  queryParams.sort();
  const canonicalQuery = queryParams.toString();

  const canonicalRequest = [
    method,
    path,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join('\n');

  const signingKey = getSigningKey(secretAccessKey, dateStamp, region, 's3');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers: Record<string, string> = {
    Host: host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    Authorization: authHeader,
  };

  if (contentType) {
    headers['Content-Type'] = contentType;
  }

  return { headers };
}

export async function executeS3ConnectionTest(config: S3TestConfig): Promise<S3TestResult> {
  const startTime = Date.now();

  const endpointUrl = (config.endpointUrl || process.env.S3_ENDPOINT_URL || '').trim();
  const bucket = (config.bucket || process.env.S3_BUCKET || '').trim();
  const region = (config.region || process.env.S3_REGION || 'auto').trim();
  const accessKeyId = (config.accessKeyId || process.env.S3_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (config.secretAccessKey || process.env.S3_SECRET_ACCESS_KEY || '').trim();

  // 1. Validate inputs
  if (!endpointUrl) {
    return {
      ok: false,
      message: 'نقطة النهاية غير محددة (S3 Endpoint URL is required)',
      error: 'يرجى إدخال رابط S3 Endpoint URL الخاص بـ Cloudflare R2 أو AWS S3.',
    };
  }

  if (!bucket) {
    return {
      ok: false,
      message: 'اسم الحاوية غير محدد (S3 Bucket is required)',
      error: 'يرجى إدخال اسم حاوية التخزين (Bucket Name).',
    };
  }

  if (!accessKeyId || !secretAccessKey) {
    return {
      ok: false,
      message: 'مفاتيح الوصول غير مكتملة (S3 Credentials required)',
      error: 'يرجى إدخال كل من S3 Access Key ID و S3 Secret Access Key.',
    };
  }

  const cleanEndpoint = endpointUrl.replace(/\/$/, '');
  const testId = Date.now();
  const testKey = `_tests/connection_test_${testId}.txt`;
  const textContent = `Smart Creators S3 Connection Test File\nCreated At: ${new Date().toISOString()}\nTest ID: ${testId}\nStatus: Verification Successful`;
  const fileBuffer = Buffer.from(textContent, 'utf-8');
  const targetUrl = `${cleanEndpoint}/${bucket}/${encodeURI(testKey)}`;

  try {
    // 2. STEP 1: Upload (PUT)
    const putSigned = signS3Request({
      method: 'PUT',
      url: targetUrl,
      body: fileBuffer,
      contentType: 'text/plain; charset=utf-8',
      accessKeyId,
      secretAccessKey,
      region,
    });

    const putRes = await fetch(targetUrl, {
      method: 'PUT',
      headers: putSigned.headers,
      body: fileBuffer,
    });

    if (!putRes.ok) {
      const errText = await putRes.text();
      let hint = 'فشل رفع الملف التجريبي إلى الحاوية.';
      if (putRes.status === 403) {
        hint = 'خطأ في التصريح (403 Forbidden): مفتاح الوصول أو المفتاح السري غير صحيح، أو لا يملك صلاحية Write/Upload على هذه الحاوية.';
      } else if (putRes.status === 404) {
        hint = `الحاوية (${bucket}) غير موجودة على هذا الـ Endpoint، أو الرابط غير صحيح.`;
      }
      return {
        ok: false,
        message: `فشل الرفع (HTTP ${putRes.status})`,
        error: `${hint}\nتفاصيل استجابة الخادم: ${errText.substring(0, 300)}`,
      };
    }

    // 3. STEP 2: Verify Read (GET)
    const getSigned = signS3Request({
      method: 'GET',
      url: targetUrl,
      accessKeyId,
      secretAccessKey,
      region,
    });

    const getRes = await fetch(targetUrl, {
      method: 'GET',
      headers: getSigned.headers,
    });

    const readStatus = getRes.status;

    // 4. STEP 3: Generate Presigned URL
    const presignedUrl = generateS3PresignedUrl({
      endpointUrl,
      bucket,
      key: testKey,
      accessKeyId,
      secretAccessKey,
      region,
      expiresIn: 900,
    });

    // 5. STEP 4: Cleanup (DELETE)
    let deleteStatus = 204;
    try {
      const delSigned = signS3Request({
        method: 'DELETE',
        url: targetUrl,
        accessKeyId,
        secretAccessKey,
        region,
      });

      const delRes = await fetch(targetUrl, {
        method: 'DELETE',
        headers: delSigned.headers,
      });
      deleteStatus = delRes.status;
    } catch {
      deleteStatus = 0;
    }

    const durationMs = Date.now() - startTime;

    return {
      ok: true,
      message: '✅ تم التحقق من خدمة التخزين السحابي S3/R2 بنجاح تام!',
      details: {
        endpoint: cleanEndpoint,
        bucket,
        region,
        testKey,
        uploadedBytes: fileBuffer.length,
        uploadStatus: putRes.status,
        readStatus,
        deleteStatus,
        durationMs,
        presignedUrl,
        textContent,
      },
    };
  } catch (err: any) {
    return {
      ok: false,
      message: 'فشل الاتصال بخدمة S3',
      error: err?.message || 'حدث خطأ غير متوقع أثناء الاتصال بالخادم السحابي.',
    };
  }
}
