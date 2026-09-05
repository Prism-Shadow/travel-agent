/**
 * Public sign-in surface: Route Penguin branding, decorative world routes and a readable form.
 * Appearance follows the existing global preferences; authentication retains its account contract.
 */
import { lazy, Suspense, useState } from "react";
import { ArrowRightIcon, LockKeyIcon, UserIcon } from "@phosphor-icons/react";
import { useNavigate } from "react-router";
import { S } from "../lib/strings";
import { apiErrorText } from "../lib/api-error";
import { developmentLoginHint } from "../lib/login-hint";
import { useDocumentTitle } from "../lib/use-document-title";
import { useAuth } from "../state/auth";
import { useLocale } from "../state/locale";
import type { LangPref } from "../state/locale";
import { useTheme } from "../state/theme";
import type { ThemeMode } from "../state/theme";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { PasswordInput } from "../components/ui/password-input";
import { TravelAgentLogo } from "../components/ui/travel-agent-logo";
import { Segmented } from "../components/ui/segmented";
import "./login.css";

const LoginMap = lazy(() => import("./login-map"));

export function LoginPage() {
  useDocumentTitle(S.auth.login);
  const { login } = useAuth();
  const { mode, setMode } = useTheme();
  const { lang, setLang } = useLocale();
  const navigate = useNavigate();
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  // Per-field required errors sit next to their input; `form` holds the auth failure (wrong user/password), which isn't specific to one field.
  const [errors, setErrors] = useState<{ userId?: string; password?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const initialLogin = developmentLoginHint();
  const clearErrors = () => setErrors((p) => (p.userId || p.password || p.form ? {} : p));

  const submit = async () => {
    const next: { userId?: string; password?: string } = {};
    if (!userId.trim()) next.userId = S.common.requiredField;
    if (!password) next.password = S.common.requiredField;
    if (next.userId || next.password) {
      setErrors(next);
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      await login(userId.trim(), password);
      navigate("/chat", { replace: true });
    } catch (e) {
      setErrors({ form: apiErrorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const themeOptions: ReadonlyArray<{ value: ThemeMode; label: string }> = [
    { value: "light", label: S.settings.themeLight },
    { value: "dark", label: S.settings.themeDark },
    { value: "system", label: S.settings.followSystem },
  ];
  const langOptions: ReadonlyArray<{ value: LangPref; label: string }> = [
    { value: "en", label: S.settings.langEn },
    { value: "zh", label: S.settings.langZh },
    { value: "system", label: S.settings.followSystem },
  ];

  return (
    <div className="login-page">
      <div className="login-map-background" aria-hidden="true">
        <Suspense fallback={null}>
          <LoginMap />
        </Suspense>
      </div>
      <header className="login-header">
        <div className="login-brand">
          <TravelAgentLogo className="h-11 w-11 shrink-0" />
          <span>{S.appName}</span>
        </div>
        <div className="login-settings">
          <div aria-label={S.settings.language}>
            <Segmented options={langOptions} value={lang} onChange={setLang} />
          </div>
          <div aria-label={S.settings.theme}>
            <Segmented options={themeOptions} value={mode} onChange={setMode} />
          </div>
        </div>
      </header>
      <main className="login-main">
        <section className="login-card" aria-labelledby="login-heading">
          <div className="login-card-heading">
            <div className="login-card-mark" aria-hidden="true">
              <TravelAgentLogo className="h-10 w-10" />
            </div>
            <h1 id="login-heading">{S.auth.journey.welcome}</h1>
            <p>{S.auth.journey.signInHint}</p>
          </div>
          <form
            className="login-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Input
              label={S.common.username}
              leadingIcon={<UserIcon size={17} />}
              required
              value={userId}
              onChange={(e) => {
                setUserId(e.target.value);
                clearErrors();
              }}
              error={errors.userId}
              autoComplete="username"
              className="login-input"
            />
            <PasswordInput
              label={S.auth.password}
              leadingIcon={<LockKeyIcon size={17} />}
              required
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                clearErrors();
              }}
              error={errors.password}
              autoComplete="current-password"
              className="login-input"
            />
            {errors.form && (
              <p
                role="alert"
                className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
              >
                {errors.form}
              </p>
            )}
            <Button
              type="submit"
              variant="primary"
              className="login-submit w-full justify-center py-2.5 text-sm font-semibold"
              disabled={busy}
              aria-busy={busy}
            >
              {S.auth.login}
              <ArrowRightIcon size={16} aria-hidden="true" />
            </Button>
          </form>

          {initialLogin ? (
            <dl className="login-credentials">
              <div>
                <dt>{S.auth.initialUsername}</dt>
                <dd>{initialLogin.userId}</dd>
              </div>
              <div>
                <dt>{S.auth.initialPassword}</dt>
                <dd>{initialLogin.password}</dd>
              </div>
            </dl>
          ) : (
            <p className="login-account-note">{S.auth.defaultAdminNote}</p>
          )}
        </section>
      </main>
    </div>
  );
}
