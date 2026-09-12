# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People reading Reddit in desktop browsers and an installed iPhone PWA.

## Product Purpose

Troddit is a self-hosted, content-first Reddit reader. It supports browsing feeds,
reading comment threads, and viewing media without making the interface compete
with the content.

## Operating Context

The application is a Next.js/React web app deployed through Docker. It supports
anonymous browsing with locally configured feeds and authenticated Reddit actions.
An installed PWA is still the web application, not a native iOS interface.

## Capabilities and Constraints

- Preserve the existing themes and remembered display preferences.
- Preserve custom feeds, filtering, media previews, and thread navigation.
- Keep the desktop and iPhone PWA experiences usable.
- Updates are advisory; reloading is an explicit, confirmed action.

## Product Principles

- Prioritize reading and media usability over decorative changes.
- Keep navigation and interaction predictable.
- Preserve user customization when improving the interface.

## Evidence on Hand

The existing implementation and assets are the visual authority. Product behavior
is documented in `README.md`; interface code lives in `src/`, with theme tokens in
`styles/globals.css` and `tailwind.config.js`.
