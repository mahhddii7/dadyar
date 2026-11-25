import "server-only";
import { setTimeout as delay } from "node:timers/promises";

export class ProviderFailure extends Error {
  constructor(message: string, readonly kind: "quota" | "rate_limit" | "other" = "other", readonly retryAfterMs?: number) {
    super(message);
    this.name = "ProviderFailure";
  }
}

const quotaMessages: Record<string, string> = {
  insufficient_quota: "اعتبار یا سهمیهٔ API کافی نیست. موجودی و سقف مصرف حساب یا پروژهٔ مربوط به همین کلید را در پنل سرویس بررسی کنید؛ تکرار درخواست این مشکل را رفع نمی‌کند.",
  credit_balance_exhausted: "موجودی اعتبار API تمام شده است. بخش Billing حساب مربوط به همین کلید را بررسی و در صورت نیاز اعتبار اضافه کنید.",
  billing_hard_limit_reached: "سقف هزینهٔ API پر شده است. سقف هزینه و موجودی حساب را در پنل سرویس بررسی کنید.",
  organization_spend_limit_exceeded: "سقف هزینهٔ سازمان پر شده است. مدیر حساب باید سقف مجاز را بررسی کند یا تا بازنشانی آن منتظر بمانید.",
  project_spend_limit_exceeded: "سقف هزینهٔ پروژه پر شده است. سقف مجاز پروژهٔ مربوط به همین کلید را بررسی کنید یا تا بازنشانی آن منتظر بمانید.",
  organization_usage_limit_exceeded: "سقف مصرف مجاز سازمان پر شده است. مدیر حساب باید از سرویس‌دهنده افزایش سقف مصرف را درخواست کند.",
};

export function retryAfterMs(value: string | null, now = Date.now()): number | undefined {
  if (!value?.trim()) return undefined;
  const text = value.trim();
  const duration = /^\d+(?:\.\d+)?$/.test(text) ? Number(text) * 1000 : Date.parse(text) - now;
  return Number.isFinite(duration) && duration >= 0 ? Math.ceil(duration) : undefined;
}

export async function httpFailure(response: Response): Promise<ProviderFailure> {
  const payload: unknown = await response.json().catch(() => null);
  const error = payload && typeof payload === "object" && "error" in payload ? payload.error : null;
  const fields = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = typeof fields.code === "string" ? fields.code : "";
  const type = typeof fields.type === "string" ? fields.type : "";
  const status = response.status;
  if (status === 429) {
    // Only known codes are shown: raw provider messages can contain keys or file data.
    const quota = [code, type].find(value => Object.hasOwn(quotaMessages, value));
    if (quota) return new ProviderFailure(`سرویس مدل HTTP 429 (${quota}): ${quotaMessages[quota]}`, "quota");
    if ([code, type].some(value => ["rate_limit_exceeded", "rate_limit_error", "too_many_requests", "slow_down"].includes(value))) {
      const wait = retryAfterMs(response.headers.get("retry-after"));
      const hint = wait !== undefined && wait > 0 ? ` حداقل ${Math.ceil(wait / 1000).toLocaleString("fa-IR")} ثانیه صبر کنید.` : " کمی صبر کنید و دوباره تلاش کنید.";
      return new ProviderFailure(`سرویس مدل HTTP 429 (rate_limit): تعداد درخواست‌ها یا حجم توکن‌ها از حد مجاز عبور کرده است.${hint} اگر ادامه داشت، حجم سؤال و شواهد یا سقف نرخ مدل را بررسی کنید.`, "rate_limit", wait);
    }
    return new ProviderFailure("سرویس مدل HTTP 429 برگرداند، اما نوع محدودیت را مشخص نکرد. در پنل سرویس، اعتبار، سقف مصرف و محدودیت نرخ مدل را بررسی کنید؛ کمبود اعتبار از این پاسخ به‌تنهایی قابل تشخیص نیست.");
  }
  const help = status === 401 || status === 403 ? "کلید API و دسترسی به مدل را بررسی کنید."
    : status === 404 ? "آدرس سرویس و شناسه مدل را بررسی کنید."
    : status >= 500 ? "سرویس مدل در پردازش درخواست خطا داد."
    : "تنظیمات مدل و سازگاری سرویس با درخواست را بررسی کنید.";
  return new ProviderFailure(`سرویس مدل کد HTTP ${status} برگرداند. ${help}`);
}

export function retryDelay(failure: ProviderFailure, attempt: number, random = Math.random): number | undefined {
  // Three total attempts. A long server delay is reported, never shortened.
  if (failure.kind !== "rate_limit" || attempt >= 2) return undefined;
  const wait = failure.retryAfterMs ?? 1000 * 2 ** attempt + Math.floor(random() * 250);
  return wait <= 15_000 ? Math.max(50, wait) : undefined;
}

export async function fetchModel(url: string, init: RequestInit & { signal: AbortSignal }): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    init.signal.throwIfAborted();
    const response = await fetch(url, init);
    if (response.ok) return response;
    const failure = await httpFailure(response);
    init.signal.throwIfAborted();
    const wait = retryDelay(failure, attempt);
    if (wait === undefined) throw failure;
    await delay(wait, undefined, { signal: init.signal });
  }
}
