import type { Metadata } from "next";
import { content, type Locale } from "./content";
import { siteOrigin } from "./site";

export function metadataFor(locale: Locale): Metadata {
  const t = content[locale];
  const canonical = locale === "zh" ? "/" : "/en";
  return {
    metadataBase: new URL(siteOrigin),
    title: t.title,
    description: t.description,
    applicationName: "Travel Agent",
    alternates: { canonical, languages: { "zh-CN": "/", en: "/en", "x-default": "/" } },
    openGraph: {
      type: "website",
      siteName: "Travel Agent",
      title: t.title,
      description: t.description,
      url: new URL(canonical, siteOrigin).href,
      locale: locale === "zh" ? "zh_CN" : "en_US",
      alternateLocale: locale === "zh" ? "en_US" : "zh_CN",
      images: [
        { url: new URL("/og.png", siteOrigin).href, width: 1729, height: 910, alt: "Travel Agent" },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: t.title,
      description: t.description,
      images: [new URL("/og.png", siteOrigin).href],
    },
    icons: { icon: "/favicon.svg", apple: "/media/logo.svg" },
  };
}
