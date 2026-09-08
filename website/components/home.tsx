"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { content, demos, downloads, links, type DemoId, type Locale } from "../lib/content";
import { HeroMap } from "./hero-map";
import { WebsitePreferences } from "./preferences";
import type { Preferences } from "../lib/preferences";

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}
function BrandIcon({ name }: { name: "github" | "apple" | "windows" | "linux" }) {
  return <span className={`brand-icon brand-icon-${name}`} aria-hidden="true" />;
}
function DownloadIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path
        d="M12 4v11m0 0l-5-5m5 5l5-5M4 20h16"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function Brand({ small = false }: { small?: boolean }) {
  return (
    <a className={`brand${small ? " brand-small" : ""}`} href="#top" aria-label="Travel Agent">
      <Image src="/media/logo.svg" width={small ? 32 : 42} height={small ? 32 : 42} alt="" />
      Travel Agent
    </a>
  );
}

function DemoRow({
  id,
  locale,
  onPlay,
}: {
  id: DemoId;
  locale: Locale;
  onPlay: (video: HTMLVideoElement) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const t = content[locale];
  const title = id === "route" ? t.routeTitle : t.hotelTitle;
  function play() {
    const element = video.current;
    if (!element) return;
    setStarted(true);
    setFailed(false);
    onPlay(element);
    if (element.error) element.load();
    void element.play().catch((error: unknown) => {
      // Starting the other recording can interrupt a pending play request.
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFailed(true);
    });
    element.focus({ preventScroll: true });
  }
  return (
    <article
      className={`demo-row${id === "hotel" ? " demo-row-reverse" : ""}`}
      aria-labelledby={`demo-title-${id}`}
    >
      <div className="demo-media">
        <video
          ref={video}
          id={`demo-video-${id}`}
          controls={started}
          playsInline
          preload="none"
          tabIndex={started ? 0 : -1}
          poster={`/media/${id}-${locale}.png`}
          src={demos[id].source}
          onPlay={(event) => {
            setStarted(true);
            setFailed(false);
            onPlay(event.currentTarget);
          }}
          onError={() => setFailed(true)}
          aria-labelledby={`demo-title-${id}`}
          aria-describedby={`demo-description-${id}`}
        >
          <track
            kind="captions"
            src={`/media/${id}-${locale}.vtt`}
            srcLang={t.locale}
            label={locale === "zh" ? "中文" : "English"}
          />
        </video>
        {!started && (
          <button
            type="button"
            className="demo-play-overlay"
            onClick={play}
            aria-label={`${t.watch}: ${title}`}
            aria-controls={`demo-video-${id}`}
          >
            <span className="duration" aria-hidden="true">
              {demos[id].duration}
            </span>
            <span className="thumbnail-play" aria-hidden="true">
              <span className="play-tiny" />
            </span>
          </button>
        )}
      </div>
      <div className="demo-copy">
        <p className="demo-kicker">
          <span>{id === "route" ? "01" : "02"}</span>
          {t.demoLabels[id === "route" ? 0 : 1]}
        </p>
        <h3 id={`demo-title-${id}`}>{title}</h3>
        <p className="demo-description" id={`demo-description-${id}`}>
          {id === "route" ? t.routeDescription : t.hotelDescription}
        </p>
        <button
          type="button"
          className="text-link demo-watch"
          onClick={play}
          aria-controls={`demo-video-${id}`}
        >
          <span className="play-tiny" aria-hidden="true" />
          {t.watch}
        </button>
        <details className="demo-walkthrough">
          <summary>{t.demoWalkthrough}</summary>
          <p>{id === "route" ? t.routeTranscript : t.hotelTranscript}</p>
        </details>
        {id === "hotel" && <p className="historical-note">{t.historical}</p>}
        {failed && (
          <p className="demo-error" role="alert">
            {t.videoUnavailable}
          </p>
        )}
        <a className="demo-original" href={demos[id].source} target="_blank" rel="noreferrer">
          {t.videoOriginal} <Arrow />
        </a>
      </div>
    </article>
  );
}

export default function Home({
  locale,
  preferences,
}: {
  locale: Locale;
  preferences: Preferences;
}) {
  const t = content[locale];
  const [menuOpen, setMenuOpen] = useState(false);
  const [browserMode, setBrowserMode] = useState<0 | 1>(0);
  const activeVideo = useRef<HTMLVideoElement | null>(null);
  const browserTabs = useRef<(HTMLButtonElement | null)[]>([]);
  const guide = locale === "zh" ? links.guideZh : links.guideEn;
  function playDemo(video: HTMLVideoElement) {
    if (activeVideo.current && activeVideo.current !== video) activeVideo.current.pause();
    activeVideo.current = video;
  }
  useEffect(() => {
    document.documentElement.lang = t.locale;
  }, [t.locale]);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [menuOpen]);
  function changeBrowserTab(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : browserMode === 0 ? 1 : 0;
    setBrowserMode(next);
    browserTabs.current[next]?.focus();
  }
  return (
    <div className={`site locale-${locale}`} lang={t.locale}>
      <a href="#main" className="skip-link">
        {t.skip}
      </a>
      <header className="site-header">
        <div className="nav-wrap">
          <Brand />
          <nav className="desktop-nav" aria-label={t.menu}>
            <a className="nav-link" href="#features">
              {t.nav[0]}
            </a>
            <a className="nav-link" href="#demos">
              {t.nav[1]}
            </a>
            <a className="nav-link" href="#start">
              {t.nav[2]}
            </a>
            <a className="nav-link nav-github" href={links.github} target="_blank" rel="noreferrer">
              <BrandIcon name="github" />
              GitHub <Arrow />
            </a>
          </nav>
          <div className="nav-actions">
            <WebsitePreferences locale={locale} initial={preferences} />
            <a className="button button-small nav-download" href="#download">
              <DownloadIcon />
              {t.download}
            </a>
            <button
              className="menu-toggle icon-button"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              aria-label={menuOpen ? t.close : t.menu}
            >
              {menuOpen ? "×" : <span className="hamburger" />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav
            id="mobile-nav"
            className="mobile-nav"
            aria-label={t.menu}
            onClick={() => setMenuOpen(false)}
          >
            <a className="nav-link" href="#features">
              {t.nav[0]}
            </a>
            <a className="nav-link" href="#demos">
              {t.nav[1]}
            </a>
            <a className="nav-link" href="#start">
              {t.nav[2]}
            </a>
            <a className="nav-link nav-github" href={links.github}>
              <BrandIcon name="github" />
              GitHub <Arrow />
            </a>
            <a className="button mobile-download" href="#download">
              <DownloadIcon />
              {t.download}
            </a>
          </nav>
        )}
      </header>
      <main id="main">
        <div id="top" />
        <section className="hero container">
          <HeroMap />
          <div className="hero-copy">
            <p className="eyebrow">
              <span />
              {t.eyebrow}
            </p>
            <h1>
              {t.hero[0]}
              <br />
              <em>{t.hero[1]}</em>
            </h1>
            <p className="hero-description">
              {t.intro[0]}
              <br />
              {t.intro[1]}
            </p>
            <div className="actions">
              <a className="button" href="#download">
                <DownloadIcon />
                {t.downloadFull}
              </a>
              <a className="button button-secondary" href="#demos">
                <span className="play-tiny" />
                {t.watch}
              </a>
            </div>
            <p className="requirements">
              macOS · Windows · Linux <span>/</span> {t.key}
            </p>
          </div>
          <div className="hero-art" aria-hidden="true">
            <Image
              className="hero-penguin"
              src="/media/penguin.svg"
              alt=""
              width={330}
              height={330}
              priority
            />
            <span className="art-caption">{t.artCaption}</span>
          </div>
        </section>
        <section className="product-preview container" aria-label={t.heroAction}>
          <a className="product-screen" href="#demos">
            <Image
              src="/media/desktop-browser.png"
              width={2986}
              height={1798}
              priority
              alt={t.heroAlt}
              unoptimized
            />
            <span className="preview-pill">
              {t.heroAction} <Arrow />
            </span>
          </a>
          <p className="media-caption">
            <span className="status-dot" />
            {t.heroCaption}
          </p>
        </section>
        <section id="demos" className="section demos-section container">
          <div className="section-heading">
            <p className="eyebrow">{t.demoEyebrow}</p>
            <h2>{t.demoTitle}</h2>
            <p>{t.demoIntro}</p>
          </div>
          <div className="demo-list">
            {(["route", "hotel"] as const).map((id) => (
              <DemoRow key={`${locale}-${id}`} id={id} locale={locale} onPlay={playDemo} />
            ))}
          </div>
          <p className="demo-footnote">{t.videoNote}</p>
        </section>
        <section id="features" className="trip-section">
          <div className="container split-section">
            <div className="feature-copy">
              <p className="eyebrow">{t.tripEyebrow}</p>
              <h2>
                {t.tripTitle[0]}
                <br />
                {t.tripTitle[1]}
              </h2>
              <p className="section-description">{t.tripDescription}</p>
              <ul className="feature-list">
                {t.tripPoints.map((point) => (
                  <li key={point}>
                    <span aria-hidden="true">✓</span>
                    {point}
                  </li>
                ))}
              </ul>
              <a className="text-link" href={guide} target="_blank" rel="noreferrer">
                {t.tripLink} <Arrow />
              </a>
            </div>
            <figure className="trip-visual">
              <Image
                src="/media/my-trips.png"
                width={1440}
                height={960}
                alt={t.tripAlt}
                unoptimized
              />
              <figcaption>{t.tripCaption}</figcaption>
            </figure>
          </div>
        </section>
        <section className="browser-section container split-section">
          <div
            className="browser-visual"
            role="tabpanel"
            id="browser-panel"
            aria-labelledby={`browser-tab-${browserMode}`}
            tabIndex={0}
          >
            <div className="browser-chrome">
              <div className="window-dots">
                <i />
                <i />
                <i />
              </div>
              <span className={`browser-tab-name ${browserMode === 1 ? "chrome-group" : ""}`}>
                {t.browserTabs[browserMode]}
              </span>
              <span className="browser-plus">+</span>
            </div>
            <div className="browser-address">
              <Image src="/media/logo.svg" width={22} height={22} alt="" />
              <span>Travel Agent</span>
              <span aria-hidden="true">⋯</span>
            </div>
            <div className={`browser-image mode-${browserMode}`}>
              <Image
                src={
                  browserMode === 0
                    ? "/media/desktop-browser.png"
                    : `/media/browser-guide-${locale}.png`
                }
                width={1440}
                height={960}
                alt={t.browserAlt[browserMode]}
                unoptimized
              />
            </div>
          </div>
          <div className="feature-copy">
            <p className="eyebrow">{t.browserEyebrow}</p>
            <h2>
              {t.browserTitle[0]}
              <br />
              {t.browserTitle[1]}
            </h2>
            <p className="section-description">{t.browserDescription}</p>
            <div className="browser-switch" role="tablist" aria-label={t.browserEyebrow}>
              {t.browserTabs.map((label, index) => (
                <button
                  key={label}
                  ref={(element) => {
                    browserTabs.current[index] = element;
                  }}
                  id={`browser-tab-${index}`}
                  type="button"
                  role="tab"
                  aria-selected={browserMode === index}
                  aria-controls="browser-panel"
                  tabIndex={browserMode === index ? 0 : -1}
                  onKeyDown={changeBrowserTab}
                  onClick={() => setBrowserMode(index as 0 | 1)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="browser-detail">{t.browserDetails[browserMode]}</p>
            <a className="text-link" href={links.extension} target="_blank" rel="noreferrer">
              {t.browserGuide} <Arrow />
            </a>
          </div>
        </section>
        <div className="control-strip container">
          {t.controls.map((label, index) => (
            <div key={label}>
              <span className="control-icon" aria-hidden="true">
                {["◎", "✓", "↗"][index]}
              </span>
              {label}
            </div>
          ))}
        </div>
        <section id="start" className="section start-section container">
          <div className="section-heading">
            <p className="eyebrow">{t.startEyebrow}</p>
            <h2>{t.startTitle}</h2>
          </div>
          <div className="steps">
            {t.steps.map((step, index) => (
              <article key={step.title}>
                <span className="step-number">0{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </article>
            ))}
          </div>
          <div className="example-request">
            <Image src="/media/logo.svg" width={42} height={42} alt="" />
            <div>
              <span>{t.exampleLabel}</span>
              <p>{t.example}</p>
            </div>
            <a href="#download" aria-label={t.download}>
              <Arrow />
            </a>
          </div>
        </section>
        <section className="faq-section container">
          <h2>{t.faqTitle}</h2>
          <div className="faq-list">
            {t.faqs.map((faq) => (
              <details key={faq.q}>
                <summary>
                  {faq.q}
                  <span className="faq-plus" aria-hidden="true">
                    +
                  </span>
                </summary>
                <p>{faq.a}</p>
              </details>
            ))}
          </div>
        </section>
        <section id="download" className="download-section">
          <div className="container">
            <div className="download-heading">
              <div>
                <p className="eyebrow">{t.downloadEyebrow}</p>
                <h2>{t.downloadTitle}</h2>
                <p>{t.downloadDescription}</p>
              </div>
              <Image src="/media/penguin.svg" width={160} height={160} alt="" />
            </div>
            <p className="download-requirement">{t.key}</p>
            <div className="download-grid">
              {downloads.map((system) => (
                <article key={system.system}>
                  <div className="download-platform">
                    <span aria-hidden="true">
                      <BrandIcon
                        name={
                          system.system === "macOS"
                            ? "apple"
                            : system.system === "Windows"
                              ? "windows"
                              : "linux"
                        }
                      />
                    </span>
                    <h3>{system.system}</h3>
                  </div>
                  <div className="download-variants">
                    {system.variants.map((variant) => (
                      <a
                        key={variant.file}
                        href={`${links.downloadBase}${variant.file}`}
                        aria-label={`${t.download} ${system.system} ${variant.name}`}
                      >
                        <span>{variant.name}</span>
                        <DownloadIcon />
                      </a>
                    ))}
                  </div>
                </article>
              ))}
            </div>
            <div className="download-footnote">
              <p>{t.unsigned}</p>
              <div>
                <a href={links.releases} target="_blank" rel="noreferrer">
                  {t.allReleases} <Arrow />
                </a>
                <a href={`${links.downloadBase}SHA256SUMS`} target="_blank" rel="noreferrer">
                  {t.checksum} <Arrow />
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
      <footer className="site-footer container">
        <div>
          <Brand small />
          <p>{t.footerTagline}</p>
        </div>
        <a href={links.engine} target="_blank" rel="noreferrer">
          {t.footerEngine}
        </a>
        <div className="footer-links">
          <a href={guide} target="_blank" rel="noreferrer">
            {t.guide}
          </a>
          <a href={links.github} target="_blank" rel="noreferrer">
            GitHub <Arrow />
          </a>
          <a href={links.license} target="_blank" rel="noreferrer">
            Apache 2.0
          </a>
        </div>
      </footer>
    </div>
  );
}
