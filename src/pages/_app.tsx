import "../../styles/globals.css";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";

import { MainProvider, localSeen } from "../MainContext";
import { MySubsProvider } from "../MySubs";
import { MyCollectionsProvider } from "../components/collections/CollectionContext";
import { DuplicateDetectionProvider } from "../components/DuplicateDetectionContext";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import Script from "next/script";
import Head from "next/head";
import { Analytics } from "@vercel/analytics/react";

import toast, { Toaster } from "react-hot-toast";
import NavBar from "../components/NavBar";
import React, { useEffect, useRef } from "react";
import packageInfo from "../../package.json";
import { checkVersion } from "../../lib/utils";
import ToastCustom from "../components/toast/ToastCustom";
import { usePlausible } from "next-plausible";
import RateLimitModal from "../components/RateLimitModal";

const VERSION = packageInfo.version;
const queryClient = new QueryClient();

const App = ({ Component, pageProps }) => {
  return (
    <SessionProvider session={pageProps.session}>
      <ThemeProvider defaultTheme="system">
        <MainProvider>
          <MySubsProvider>
            <MyCollectionsProvider>
              <DuplicateDetectionProvider>
                <QueryClientProvider client={queryClient}>
                  <NavBar />
                  <Component {...pageProps} />
                  <RateLimitModal />
                  <Toaster position="bottom-center" />
                  <Analytics />
                  <ReactQueryDevtools initialIsOpen={false} />
                </QueryClientProvider>
              </DuplicateDetectionProvider>
            </MyCollectionsProvider>
          </MySubsProvider>
        </MainProvider>
      </ThemeProvider>
    </SessionProvider>
  );
};

function MyApp({ Component, pageProps }) {
  const plausible = usePlausible();
  useEffect(() => {
    const curVersion = VERSION;
    const prevVersion = localStorage.getItem("trodditVersion");
    if (prevVersion) {
      let compare = checkVersion(curVersion, prevVersion);
      // if (compare === 1) {
      //   const toastId = toast.custom(
      //     (t) => (
      //       <ToastCustom
      //         t={t}
      //         message={`Troddit updated! Click to see changelog`}
      //         mode={"version"}
      //       />
      //     ),
      //     { position: "bottom-center", duration: 8000 }
      //   );
      // }
    }
    localStorage.setItem("trodditVersion", curVersion);
  }, []);
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
