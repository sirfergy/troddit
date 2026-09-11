import "../../styles/globals.css";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";

import { MainProvider } from "../MainContext";
import { MySubsProvider } from "../MySubs";
import { MyCollectionsProvider } from "../components/collections/CollectionContext";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import Script from "next/script";
import Head from "next/head";
import { Analytics } from "@vercel/analytics/react";

import { Toaster } from "react-hot-toast";
import NavBar from "../components/NavBar";
import React from "react";
import packageInfo from "../../package.json";
import RateLimitModal from "../components/RateLimitModal";
import { AppUpdatesProvider } from "../AppUpdates";

const VERSION = packageInfo.version;
const queryClient = new QueryClient();

const App = ({ Component, pageProps }) => {
  return (
    <SessionProvider session={pageProps.session}>
      <ThemeProvider defaultTheme="system">
        <AppUpdatesProvider version={VERSION}>
        <MainProvider>
          <MySubsProvider>
            <MyCollectionsProvider>
              <QueryClientProvider client={queryClient}>
                <NavBar />
                <Component {...pageProps} />
                <RateLimitModal />
                <Toaster position="bottom-center" />
                <Analytics />
                <ReactQueryDevtools initialIsOpen={false} />
              </QueryClientProvider>
            </MyCollectionsProvider>
          </MySubsProvider>
        </MainProvider>
        </AppUpdatesProvider>
      </ThemeProvider>
    </SessionProvider>
  );
};

function MyApp({ Component, pageProps }) {
  return (
    <>
      <Script defer data-domain={"troddit.com"} src="/js/script.js"></Script>

      <Head>
        <meta
          name="viewport"
          content="minimum-scale=1, initial-scale=1, width=device-width, shrink-to-fit=no, viewport-fit=cover" //user-scalable="no"
        />
        <link rel="shortcut icon" href="/favicon.ico" />
      </Head>

      <App Component={Component} pageProps={pageProps} />
    </>
  );
}

export default MyApp;
