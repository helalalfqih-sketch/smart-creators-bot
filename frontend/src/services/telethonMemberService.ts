import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { DatabaseService } from '../db/database';
import { BotUser } from '../types';
import { loadPersistentConfig } from './configPersistence';

export interface ScrapedMember {
  id: string | number;
  first_name: string;
  last_name?: string;
  username?: string;
  role: 'Creator' | 'Admin' | 'Member' | 'Active Commenter' | 'Author';
  is_bot: boolean;
  is_premium?: boolean;
  phone?: string;
  avatar_url?: string;
  source_channel: string;
  discovered_at: string;
  activity_note?: string;
}

export interface TelethonScrapeOptions {
  target: string; // e.g. "https://t.me/IT_comment1", "@IT_comment1", or "-1002109107801"
  apiId?: number;
  apiHash?: string;
  sessionString?: string;
  limit?: number; // default 100
  mode?: 'auto' | 'telethon_mtproto' | 'deep_web_bot';
}

export interface ScrapeResult {
  ok: boolean;
  channel: {
    id: string | number;
    title: string;
    username?: string;
    type: string;
    member_count?: number;
    description?: string;
    linked_chat_id?: string | number;
    linked_chat_title?: string;
  };
  members: ScrapedMember[];
  saved_to_db: number;
  mode_used: 'telethon_mtproto' | 'deep_web_bot';
  logs: string[];
  error?: string;
}

export class TelethonMemberService {
  /**
   * Main entry point for scraping members of any Telegram channel or group.
   */
  public static async scrapeMembers(options: TelethonScrapeOptions): Promise<ScrapeResult> {
    const logs: string[] = [];
    const membersMap = new Map<string, ScrapedMember>();
    const now = new Date().toISOString();

    const config = loadPersistentConfig();
    const botToken = config.BOT_TOKEN || process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';
    const apiId = Number(options.apiId || process.env.TELEGRAM_API_ID || config.TELEGRAM_API_ID || 0);
    const apiHash = options.apiHash || process.env.TELEGRAM_API_HASH || config.TELEGRAM_API_HASH || '';
    const sessionString = options.sessionString || process.env.TELEGRAM_SESSION_STRING || config.TELEGRAM_SESSION_STRING || '';
    const limit = Math.min(Math.max(options.limit || 100, 10), 1000);

    let cleanTarget = options.target.trim();
    const tmeMatch = cleanTarget.match(/(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([a-zA-Z0-9_+]+)/i);
    if (tmeMatch) {
      cleanTarget = tmeMatch[1];
    } else if (cleanTarget.startsWith('@')) {
      cleanTarget = cleanTarget.replace('@', '');
    }

    logs.push(`🔍 بدء فحص القناة/المجموعة: @${cleanTarget} (الحد الأقصى: ${limit})`);

    // Basic channel info structure
    const channelInfo = {
      id: cleanTarget,
      title: cleanTarget,
      username: cleanTarget,
      type: 'channel',
      member_count: 0,
      description: '',
      linked_chat_id: undefined as string | number | undefined,
      linked_chat_title: undefined as string | undefined,
    };

    let modeUsed: 'telethon_mtproto' | 'deep_web_bot' = 'deep_web_bot';

    // 1. TRY TELETHON MTPROTO IF CREDENTIALS AVAILABLE
    const canUseTelethon = (options.mode === 'telethon_mtproto' || options.mode === 'auto') && apiId > 0 && apiHash.length > 5;

    if (canUseTelethon) {
      try {
        logs.push(`⚡ محاولة الاتصال عبر بروتوكول Telethon MTProto (API ID: ${apiId})...`);
        const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
          connectionRetries: 2,
          timeout: 10000,
        });

        if (sessionString) {
          await client.connect();
        } else if (botToken && botToken !== '••••••••') {
          await client.start({ botAuthToken: botToken });
        }

        if (client.connected) {
          logs.push(`✅ تم الاتصال بـ Telethon MTProto بنجاح! جلب بيانات الكيان...`);
          const entity: any = await client.getEntity(cleanTarget);
          if (entity) {
            channelInfo.id = entity.id?.toString() || cleanTarget;
            channelInfo.title = entity.title || cleanTarget;
            channelInfo.username = entity.username || cleanTarget;
            channelInfo.type = entity.megagroup ? 'supergroup' : entity.broadcast ? 'channel' : 'group';
            channelInfo.member_count = entity.participantsCount || 0;

            logs.push(`📋 تم العثور على: ${channelInfo.title} (${channelInfo.member_count} مشترك)`);

            // Fetch participants using Telethon MTProto
            try {
              logs.push(`📥 جلب قائمة المشاركين من Telethon...`);
              const participants = await client.getParticipants(entity, { limit });
              logs.push(`✨ تم سحب ${participants.length} عضو عبر Telethon MTProto مباشرة!`);

              for (const p of participants) {
                const uid = p.id?.toString();
                if (!uid) continue;
                const isCreator = (p as any).participant?.className === 'ChannelParticipantCreator';
                const isAdmin = (p as any).participant?.className === 'ChannelParticipantAdmin' || isCreator;
                
                membersMap.set(uid, {
                  id: uid,
                  first_name: p.firstName || p.username || `مستخدم ${uid}`,
                  last_name: p.lastName || '',
                  username: p.username || '',
                  role: isCreator ? 'Creator' : isAdmin ? 'Admin' : 'Member',
                  is_bot: Boolean(p.bot),
                  is_premium: Boolean((p as any).premium),
                  phone: (p as any).phone || '',
                  source_channel: channelInfo.title || `@${cleanTarget}`,
                  discovered_at: now,
                  activity_note: 'سحب كامل عبر بروتوكول Telethon MTProto',
                });
              }

              modeUsed = 'telethon_mtproto';
            } catch (partErr: any) {
              logs.push(`⚠️ تعذر استخدام getParticipants المباشر (${partErr.message}). الانتقال لسحب رسائل المتفاعلين...`);
              
              // Telethon messages participants scraping fallback
              try {
                const messages = await client.getMessages(entity, { limit: Math.min(limit * 2, 200) });
                logs.push(`📨 تم فحص ${messages.length} رسالة لاستخراج المعلقين والناشرين...`);
                for (const m of messages) {
                  if (m.sender && m.sender.id) {
                    const uid = m.sender.id.toString();
                    if (!membersMap.has(uid)) {
                      membersMap.set(uid, {
                        id: uid,
                        first_name: (m.sender as any).firstName || (m.sender as any).username || `عضو ${uid}`,
                        last_name: (m.sender as any).lastName || '',
                        username: (m.sender as any).username || '',
                        role: 'Active Commenter',
                        is_bot: Boolean((m.sender as any).bot),
                        source_channel: channelInfo.title || `@${cleanTarget}`,
                        discovered_at: now,
                        activity_note: `نشر رسالة #${m.id} في القناة`,
                      });
                    }
                  }
                }
              } catch (msgErr: any) {
                logs.push(`⚠️ خطأ في قراءة الرسائل: ${msgErr.message}`);
              }
            }
          }
        }
      } catch (telErr: any) {
        logs.push(`⚠️ لم تكتمل جلسة Telethon MTProto (${telErr.message}). يتم الانتقال للمحرك الذكي البديل (Deep Web & Bot API)...`);
      }
    }

    // 2. ENRICH WITH TELEGRAM BOT API & WEB ENGINE SCRAPING
    try {
      logs.push(`🌐 فحص القناة عبر Telegram API والويب المفتوح (Deep Web Scraper)...`);
      
      // A. Bot API Chat info
      if (botToken && botToken !== '••••••••') {
        try {
          const chatRes = await fetch(`https://api.telegram.org/bot${botToken}/getChat?chat_id=@${cleanTarget}`);
          const chatData = await chatRes.json();
          if (chatData.ok && chatData.result) {
            const resChat = chatData.result;
            channelInfo.id = resChat.id;
            channelInfo.title = resChat.title || channelInfo.title;
            channelInfo.username = resChat.username || channelInfo.username;
            channelInfo.type = resChat.type;
            channelInfo.description = resChat.description || '';
            channelInfo.linked_chat_id = resChat.linked_chat_id;

            // Fetch member count
            const countRes = await fetch(`https://api.telegram.org/bot${botToken}/getChatMemberCount?chat_id=${resChat.id}`);
            const countData = await countRes.json();
            if (countData.ok) {
              channelInfo.member_count = countData.result;
            }

            // Fetch admins
            const adminRes = await fetch(`https://api.telegram.org/bot${botToken}/getChatAdministrators?chat_id=${resChat.id}`);
            const adminData = await adminRes.json();
            if (adminData.ok && Array.isArray(adminData.result)) {
              logs.push(`👑 تم العثور على ${adminData.result.length} مسؤول ومشرف في القناة`);
              for (const adm of adminData.result) {
                const u = adm.user;
                if (u && u.id) {
                  const uid = u.id.toString();
                  membersMap.set(uid, {
                    id: uid,
                    first_name: u.first_name || u.username || 'مسؤول',
                    last_name: u.last_name || '',
                    username: u.username || '',
                    role: adm.status === 'creator' ? 'Creator' : 'Admin',
                    is_bot: Boolean(u.is_bot),
                    source_channel: channelInfo.title || `@${cleanTarget}`,
                    discovered_at: now,
                    activity_note: `مشرف/منشئ (${adm.status}) - ${adm.custom_title || 'إدارة القناة'}`,
                  });
                }
              }
            }

            // Linked chat checking & inspection
            if (resChat.linked_chat_id) {
              try {
                const linkRes = await fetch(`https://api.telegram.org/bot${botToken}/getChat?chat_id=${resChat.linked_chat_id}`);
                const linkData = await linkRes.json();
                if (linkData.ok && linkData.result) {
                  channelInfo.linked_chat_title = linkData.result.title;
                  logs.push(`🔗 تم اكتشاف القناة/المجموعة التابعة المرتبطة: ${linkData.result.title}`);

                  // Extract pinned message author if present
                  if (linkData.result.pinned_message?.author_signature) {
                    const authorSig = linkData.result.pinned_message.author_signature;
                    const sigKey = `author_${encodeURIComponent(authorSig.toLowerCase())}`;
                    membersMap.set(sigKey, {
                      id: sigKey,
                      first_name: authorSig,
                      role: 'Creator',
                      is_bot: false,
                      source_channel: linkData.result.title || channelInfo.title,
                      discovered_at: now,
                      activity_note: `منشئ/مسؤول وكاتب الرسائل المثبتة في ${linkData.result.title}`,
                    });
                    logs.push(`📌 تم استخراج كاتب الرسائل المثبتة: ${authorSig}`);
                  }
                }
              } catch {}
            }

            // Extract mentions from description
            const desc = resChat.description || '';
            const descMentions: string[] = desc.match(/@[a-zA-Z0-9_]{4,32}/g) || [];
            const uniqueDescMentions = Array.from(new Set(descMentions)).map((m: any) => String(m).replace('@', ''));
            for (const dm of uniqueDescMentions) {
              if (dm.toLowerCase() !== cleanTarget.toLowerCase()) {
                const dmKey = `user_${dm.toLowerCase()}`;
                membersMap.set(dmKey, {
                  id: dmKey,
                  first_name: `@${dm}`,
                  username: dm,
                  role: 'Admin',
                  is_bot: false,
                  source_channel: channelInfo.title || `@${cleanTarget}`,
                  discovered_at: now,
                  activity_note: `مسؤول التواصل المباشر في وصف ${channelInfo.title}`,
                });
                logs.push(`👤 تم استخراج جهة اتصال/مسؤول من الوصف: @${dm}`);
              }
            }
          }
        } catch (botErr: any) {
          logs.push(`⚠️ تعذر استدعاء Bot API: ${botErr.message}`);
        }
      }

      // B. Public Web Channel Feed Scraping (https://t.me/s/TARGET)
      try {
        logs.push(`📡 فحص سجل المنشورات والتعليقات المفتوحة من feed القناة...`);
        const webRes = await fetch(`https://t.me/s/${cleanTarget}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          },
        });
        if (webRes.ok) {
          const html = await webRes.text();
          
          // Match usernames in links
          const userLinkRegex = /href=["']https:\/\/t\.me\/([a-zA-Z0-9_]{4,32})["']/g;
          let match;
          const foundUsernames = new Set<string>();
          while ((match = userLinkRegex.exec(html)) !== null) {
            const u = match[1];
            if (u.toLowerCase() !== cleanTarget.toLowerCase() && !['telegram', 'botfather', 'durov', 'contest'].includes(u.toLowerCase())) {
              foundUsernames.add(u);
            }
          }

          // Match signature authors
          const authorRegex = /<span class="tgme_widget_message_from_author">([^<]+)<\/span>/g;
          let aMatch;
          while ((aMatch = authorRegex.exec(html)) !== null) {
            const authorName = aMatch[1].trim();
            if (authorName) {
              const authorKey = `author_${encodeURIComponent(authorName.toLowerCase())}`;
              if (!membersMap.has(authorKey)) {
                membersMap.set(authorKey, {
                  id: authorKey,
                  first_name: authorName,
                  role: 'Author',
                  is_bot: false,
                  source_channel: channelInfo.title || `@${cleanTarget}`,
                  discovered_at: now,
                  activity_note: `كاتب وناشر منشورات معتمد في ${channelInfo.title}`,
                });
              }
            }
          }

          logs.push(`🔎 تم استخراج ${foundUsernames.size} جهة اتصال ومستخدم متفاعل من منشورات القناة`);
          foundUsernames.forEach((uName) => {
            const key = `user_${uName.toLowerCase()}`;
            if (!membersMap.has(key)) {
              membersMap.set(key, {
                id: key,
                first_name: `@${uName}`,
                username: uName,
                role: 'Active Commenter',
                is_bot: false,
                source_channel: channelInfo.title || `@${cleanTarget}`,
                discovered_at: now,
                activity_note: `متفاعل / مذكور في منشورات @${cleanTarget}`,
              });
            }
          });
        }
      } catch (feedErr: any) {
        logs.push(`⚠️ تعذر قراءة الـ Web Feed: ${feedErr.message}`);
      }

    } catch (err: any) {
      logs.push(`⚠️ خطأ في المحرك المساعد: ${err.message}`);
    }

    const membersList = Array.from(membersMap.values());
    logs.push(`📊 إجمالي المستخدمين المستخرجين: ${membersList.length} مستخدم`);

    // 3. PERSIST ALL SCRAPED MEMBERS TO DATABASE
    let savedCount = 0;
    try {
      const db = DatabaseService.getInstance();

      // Also ensure the channel entity itself is saved
      const channelKey = String(channelInfo.id);
      db.upsertUser({
        id: channelKey.startsWith('-') ? channelKey : `-100${channelKey}`,
        telegram_id: channelInfo.id,
        username: channelInfo.username,
        first_name: channelInfo.title,
        role: 'user',
        plan_id: 'pro',
        status: 'active',
        created_at: now,
        updated_at: now,
      });

      for (const m of membersList) {
        const idStr = String(m.id);
        db.upsertUser({
          id: idStr,
          telegram_id: idStr.startsWith('user_') || idStr.startsWith('author_') ? undefined : idStr,
          username: m.username || undefined,
          first_name: m.first_name,
          last_name: m.last_name || undefined,
          role: m.role === 'Creator' || m.role === 'Admin' ? 'admin' : m.is_premium ? 'vip' : 'user',
          plan_id: m.is_premium ? 'pro' : 'free',
          status: 'active',
          created_at: now,
          updated_at: now,
        });
        savedCount++;
      }

      logs.push(`💾 تم تخزين وتحديث ${savedCount} سجل في قاعدة بيانات المستخدمين بنجاح!`);
    } catch (dbErr: any) {
      logs.push(`⚠️ تنبيه في حفظ قاعدة البيانات: ${dbErr.message}`);
    }

    return {
      ok: true,
      channel: channelInfo,
      members: membersList,
      saved_to_db: savedCount,
      mode_used: modeUsed,
      logs,
    };
  }
}
