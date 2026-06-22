import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/http';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import * as auth from '../services/auth.service';
import * as oauth from '../services/oauth.service';

// ════════════════════════════════════════════════════════════════════
//  Auth routes — /api/auth  (register / login / refresh / logout / me)
//  refresh token รับ/ส่งผ่าน body (frontend เก็บใน localStorage)
// ════════════════════════════════════════════════════════════════════

const router = Router();

const registerBody = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'รหัสผ่านอย่างน้อย 8 ตัวอักษร'),
  name: z.string().min(1).optional(),
});
const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
const refreshBody = z.object({ refreshToken: z.string().min(1) });

router.post(
  '/register',
  validate({ body: registerBody }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await auth.register(req.body, req.get('user-agent')));
  }),
);

router.post(
  '/login',
  validate({ body: loginBody }),
  asyncHandler(async (req, res) => {
    res.json(await auth.login(req.body, req.get('user-agent')));
  }),
);

router.post(
  '/refresh',
  validate({ body: refreshBody }),
  asyncHandler(async (req, res) => {
    res.json(await auth.refresh(req.body.refreshToken, req.get('user-agent')));
  }),
);

router.post(
  '/logout',
  validate({ body: refreshBody.partial() }),
  asyncHandler(async (req, res) => {
    await auth.logout(req.body?.refreshToken);
    res.status(204).end();
  }),
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await auth.getMe(req.user!.id));
  }),
);

// ── OAuth (Google / LINE) — login with provider (ข้อ 1.2.3) ───────────
// start: เด้งไปหน้า consent ของ provider
router.get(
  '/oauth/:provider/start',
  asyncHandler(async (req, res) => {
    res.redirect(oauth.getAuthorizeUrl(req.params.provider));
  }),
);

// callback: provider เด้งกลับมาพร้อม code → แลก token → ส่งต่อให้ frontend ผ่าน hash
router.get(
  '/oauth/:provider/callback',
  asyncHandler(async (req, res) => {
    const fe = oauth.frontendCallbackUrl();
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    if (!code || !state) {
      const reason = (req.query.error_description as string) || 'ไม่ได้รับ code จาก provider';
      return res.redirect(`${fe}#error=${encodeURIComponent(reason)}`);
    }
    try {
      const tokens = await oauth.handleCallback(req.params.provider, code, state, req.get('user-agent'));
      const frag = new URLSearchParams({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      });
      return res.redirect(`${fe}#${frag.toString()}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'เข้าสู่ระบบไม่สำเร็จ';
      return res.redirect(`${fe}#error=${encodeURIComponent(msg)}`);
    }
  }),
);

export default router;
