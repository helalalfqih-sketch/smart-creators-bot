import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'translate-and-media-proxy',
      configureServer(server) {
        server.middlewares.use('/api/translate', async (req, res) => {
          try {
            const urlObj = new URL(req.url || '', 'http://localhost:3000');
            const text = urlObj.searchParams.get('text') || '';
            if (!text) {
              res.setHeader('Content-Type', 'application/json');
              return res.end(JSON.stringify({ translated: '' }));
            }
            const target = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ar&dt=t&q=${encodeURIComponent(text)}`;
            const response = await fetch(target, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
            });
            const data = await response.json();
            let translated = '';
            if (Array.isArray(data) && Array.isArray(data[0])) {
              translated = data[0].map((item: any) => item[0] || '').join('').trim();
            }
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ translated: translated || text }));
          } catch (e: any) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ translated: '' }));
          }
        });

        server.middlewares.use('/api/search-videos', async (req, res) => {
          try {
            const urlObj = new URL(req.url || '', 'http://localhost:3000');
            const query = urlObj.searchParams.get('q') || '';
            const limit = parseInt(urlObj.searchParams.get('limit') || '6', 10);
            if (!query) {
              res.setHeader('Content-Type', 'application/json');
              return res.end(JSON.stringify([]));
            }

            // Method 1: Direct YouTube Search scraping on server
            try {
              const ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
              const ytRes = await fetch(ytUrl, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                  'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
                },
              });

              if (ytRes.ok) {
                const html = await ytRes.text();
                const jsonMatch =
                  html.match(/var ytInitialData = ({.*?});<\/script>/) ||
                  html.match(/ytInitialData\s*=\s*({.+?});/);

                if (jsonMatch && jsonMatch[1]) {
                  const data = JSON.parse(jsonMatch[1]);
                  const sectionList =
                    data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;

                  if (Array.isArray(sectionList)) {
                    const results: any[] = [];
                    for (const section of sectionList) {
                      const items = section?.itemSectionRenderer?.contents;
                      if (Array.isArray(items)) {
                        for (const item of items) {
                          const vr = item.videoRenderer;
                          if (vr && vr.videoId) {
                            const title =
                              vr.title?.runs?.[0]?.text ||
                              vr.title?.accessibility?.accessibilityData?.label ||
                              'فيديو يوتيوب';
                            const channel =
                              vr.ownerText?.runs?.[0]?.text ||
                              vr.shortBylineText?.runs?.[0]?.text ||
                              'قناة يوتيوب';
                            const duration = vr.lengthText?.simpleText || 'فيديو';
                            const views = vr.viewCountText?.simpleText || vr.shortViewCountText?.simpleText;
                            const thumb =
                              vr.thumbnail?.thumbnails?.[vr.thumbnail.thumbnails.length - 1]?.url ||
                              `https://i.ytimg.com/vi/${vr.videoId}/hqdefault.jpg`;

                            results.push({
                              id: vr.videoId,
                              title: title.trim(),
                              url: `https://www.youtube.com/watch?v=${vr.videoId}`,
                              thumbnail: thumb,
                              channel: channel.trim(),
                              duration,
                              views,
                              platform: 'YouTube',
                            });

                            if (results.length >= limit) break;
                          }
                        }
                      }
                      if (results.length >= limit) break;
                    }

                    if (results.length > 0) {
                      res.setHeader('Content-Type', 'application/json');
                      return res.end(JSON.stringify(results));
                    }
                  }
                }
              }
            } catch (ytErr) {
              console.warn('Server YouTube scrape fallback:', ytErr);
            }

            // Method 2: Public Invidious / Piped instances from server
            const backupInstances = [
              `https://invidious.nerdvpn.de/api/v1/search?q=${encodeURIComponent(query)}&type=video`,
              `https://inv.tux.pizza/api/v1/search?q=${encodeURIComponent(query)}&type=video`,
            ];

            for (const bUrl of backupInstances) {
              try {
                const bRes = await fetch(bUrl, {
                  headers: { 'User-Agent': 'Mozilla/5.0' },
                });
                if (bRes.ok) {
                  const bData = await bRes.json();
                  if (Array.isArray(bData) && bData.length > 0) {
                    const mapped = bData
                      .filter((x: any) => x.type === 'video' && x.videoId)
                      .slice(0, limit)
                      .map((x: any) => ({
                        id: x.videoId,
                        title: x.title || 'فيديو',
                        url: `https://www.youtube.com/watch?v=${x.videoId}`,
                        thumbnail: `https://i.ytimg.com/vi/${x.videoId}/hqdefault.jpg`,
                        channel: x.author || 'يوتيوب',
                        duration: x.lengthSeconds ? `${Math.floor(x.lengthSeconds / 60)}:${(x.lengthSeconds % 60).toString().padStart(2, '0')}` : 'فيديو',
                        views: x.viewCount ? `${Number(x.viewCount).toLocaleString('ar-EG')} مشاهدة` : undefined,
                        platform: 'YouTube',
                      }));
                    if (mapped.length > 0) {
                      res.setHeader('Content-Type', 'application/json');
                      return res.end(JSON.stringify(mapped));
                    }
                  }
                }
              } catch {
                // Next
              }
            }

            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify([]));
          } catch (e: any) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify([]));
          }
        });

        server.middlewares.use('/api/extract-media', async (req, res) => {
          try {
            const urlObj = new URL(req.url || '', 'http://localhost:3000');
            const targetUrl = urlObj.searchParams.get('url') || '';
            if (!targetUrl) {
              res.setHeader('Content-Type', 'application/json');
              return res.end(JSON.stringify({ code: -1, msg: 'No URL provided' }));
            }

            // Fetch from TikWM with proper headers
            const tikwmUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(targetUrl)}&hd=1`;
            const resp = await fetch(tikwmUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json',
              }
            });
            const data = await resp.json();
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
          } catch (e: any) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ code: -1, msg: e?.message || 'Proxy extraction error' }));
          }
        });

        // S3 / Cloudflare R2 Connection Test API endpoint
        server.middlewares.use('/api/storage/test-connection', async (req, res) => {
          let bodyText = '';
          req.on('data', (chunk) => {
            bodyText += chunk;
          });

          req.on('end', async () => {
            try {
              let body: any = {};
              if (bodyText) {
                try {
                  body = JSON.parse(bodyText);
                } catch {
                  body = {};
                }
              }

              const urlObj = new URL(req.url || '', 'http://localhost:3000');
              const endpointUrl =
                body.endpointUrl ||
                body.S3_ENDPOINT_URL ||
                urlObj.searchParams.get('endpointUrl') ||
                process.env.S3_ENDPOINT_URL ||
                '';
              const bucket =
                body.bucket ||
                body.S3_BUCKET ||
                urlObj.searchParams.get('bucket') ||
                process.env.S3_BUCKET ||
                '';
              const region =
                body.region ||
                body.S3_REGION ||
                urlObj.searchParams.get('region') ||
                process.env.S3_REGION ||
                'auto';
              const accessKeyId =
                body.accessKeyId ||
                body.S3_ACCESS_KEY_ID ||
                urlObj.searchParams.get('accessKeyId') ||
                process.env.S3_ACCESS_KEY_ID ||
                '';
              const secretAccessKey =
                body.secretAccessKey ||
                body.S3_SECRET_ACCESS_KEY ||
                urlObj.searchParams.get('secretAccessKey') ||
                process.env.S3_SECRET_ACCESS_KEY ||
                '';

              const { executeS3ConnectionTest } = await import('./src/services/s3TestHelper');
              const result = await executeS3ConnectionTest({
                endpointUrl,
                bucket,
                region,
                accessKeyId,
                secretAccessKey,
              });

              res.statusCode = result.ok ? 200 : 400;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify(result));
            } catch (err: any) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(
                JSON.stringify({
                  ok: false,
                  message: 'خطأ غير متوقع أثناء فحص اتصال S3',
                  error: err?.message || 'Server error',
                })
              );
            }
          });
        });

        // Persistent System Configuration API
        server.middlewares.use('/api/config', async (req, res) => {
          if (req.method === 'POST') {
            let bodyText = '';
            req.on('data', (chunk) => {
              bodyText += chunk;
            });
            req.on('end', async () => {
              try {
                let updated: any = {};
                if (bodyText) {
                  try {
                    updated = JSON.parse(bodyText);
                  } catch {
                    updated = {};
                  }
                }
                const { savePersistentConfig } = await import('./src/services/configPersistence');
                const config = savePersistentConfig(updated);
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ ok: true, message: 'Configuration saved permanently', config }));
              } catch (err: any) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ ok: false, error: err?.message || 'Failed to save config' }));
              }
            });
          } else {
            try {
              const { loadPersistentConfig } = await import('./src/services/configPersistence');
              const config = loadPersistentConfig();
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ ok: true, config }));
            } catch (err: any) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ ok: false, error: err?.message || 'Failed to load config' }));
            }
          }
        });
      }
    }
  ],
  define: {
    'global': 'window',
  },
  resolve: {
    alias: {
      buffer: 'buffer',
      events: 'events',
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    hmr: process.env.DISABLE_HMR === 'true' ? false : undefined,
  },
});
