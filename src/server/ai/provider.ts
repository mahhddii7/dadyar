import "server-only";

export interface ModelStatus {
  provider: "ollama" | "openai-compatible" | "none";
  model: string | null;
  available: boolean;
  message: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function providerName(): ModelStatus["provider"] {
  const value = (process.env.AI_PROVIDER || "openai-compatible").toLowerCase();
  if (value === "openai-compatible") return value;
  if (value === "none") return value;
  return "ollama";
}

export async function getModelStatus(): Promise<ModelStatus> {
  const provider = providerName();
  if (provider === "none") return { provider, model: null, available: false, message: "مدل زبانی غیرفعال است؛ تحلیل‌های عددی پایه همچنان در دسترس‌اند." };
  if (provider === "openai-compatible") {
    const model = process.env.AI_MODEL?.trim() || null;
    const available = Boolean(process.env.AI_API_KEY?.trim() && model);
    return {
      provider,
      model,
      available,
      message: available ? "کلید و نام مدل تنظیم شده‌اند؛ اتصال با اولین درخواست بررسی می‌شود." : "کلید API و نام دقیق مدل را در فایل .env.local تنظیم کنید.",
    };
  }
  const baseUrl = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
  try {
    const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(1800), cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json() as { models?: Array<{ name: string }> };
    const model = process.env.OLLAMA_MODEL || "qwen3.5:9b";
    const installed = payload.models?.some((item) => item.name === model || item.name.startsWith(`${model.split(":")[0]}:`)) ?? false;
    return {
      provider,
      model,
      available: installed,
      message: installed ? `مدل محلی ${model} آماده است.` : `Ollama در دسترس است، اما مدل ${model} نصب نشده؛ آن را دریافت کنید یا نام مدل را در تنظیمات تغییر دهید.`,
    };
  } catch {
    return { provider, model: process.env.OLLAMA_MODEL || "qwen3.5:9b", available: false, message: "Ollama پیدا نشد؛ تحلیل عددی پایه کار می‌کند و برای پرسش‌های متنی باید Ollama را اجرا کنید." };
  }
}

class ProviderFailure extends Error {}

function httpFailure(status: number) {
  const help = status === 401 || status === 403 ? "کلید API و دسترسی به مدل را بررسی کنید."
    : status === 404 ? "آدرس سرویس و شناسه مدل را بررسی کنید."
    : status === 429 ? "محدودیت درخواست یا اعتبار سرویس را بررسی کنید."
    : status >= 500 ? "سرویس مدل در پردازش درخواست خطا داد."
    : "تنظیمات مدل و سازگاری سرویس با درخواست را بررسی کنید.";
  return new ProviderFailure(`سرویس مدل کد HTTP ${status} برگرداند. ${help}`);
}

export function modelErrorMessage(error: unknown) {
  if (error instanceof ProviderFailure) return error.message;
  if (error instanceof Error && ["TimeoutError","AbortError"].includes(error.name)) return "زمان پاسخ‌گویی مدل به پایان رسید.";
  if (error instanceof TypeError) return "ارتباط شبکه با سرویس مدل برقرار نشد. آدرس سرویس و شبکه را بررسی کنید.";
  return "پاسخ سرویس مدل قابل خواندن نبود.";
}

export async function requestModel(messages: ChatMessage[], jsonMode = false): Promise<string> {
  const provider = providerName();
  if (provider === "none") throw new ProviderFailure("مدل زبانی غیرفعال است.");
  if (provider === "openai-compatible") {
    if (!process.env.AI_API_KEY) throw new ProviderFailure("AI_API_KEY تنظیم نشده است.");
    const baseUrl = (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
    const model = process.env.AI_MODEL?.trim();
    if (!model) throw new ProviderFailure("AI_MODEL تنظیم نشده است؛ نام دقیق مدل را از پنل سرویس‌دهنده وارد کنید.");
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.AI_API_KEY}` },
      body: JSON.stringify({ model, messages }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw httpFailure(response.status);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new ProviderFailure("مدل پاسخی برنگرداند.");
    return content;
  }

  const baseUrl = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL || "qwen3.5:9b",
      messages,
      stream: false,
      ...(jsonMode ? { format: "json" } : {}),
      options: { temperature: 0.1 },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw httpFailure(response.status);
  const payload = await response.json() as { message?: { content?: string } };
  if (!payload.message?.content) throw new ProviderFailure("مدل پاسخی برنگرداند.");
  return payload.message.content;
}
