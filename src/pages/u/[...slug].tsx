import router, { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Link from "next/link";
import Head from "next/head";
import NavBar from "../../components/NavBar";
import Feed from "../../components/Feed";
const Sort = ({ query }) => {
  const [loaded, setLoaded] = useState(false);
  const [isUser, setIsUser] = useState(false);
  const [feedQuery, setFeedQuery] = useState("");
  useEffect(() => {
    //console.log(query);
    if (query?.slug?.[1] === "p") {
      router.replace(`/${query.slug?.[2]}`);
    } else {
      setIsUser(true);
      setFeedQuery(query);
    }
    setLoaded(true);
    return () => {
      setLoaded(false);
      setIsUser(false);
      setFeedQuery("");
    };
  }, [query]);

  const [toggleSideNav, setToggleSideNav] = useState(0);
  const [touchStart, setTouchStart] = useState(0);
  const [touchEnd, setTouchEnd] = useState(0);
  const handleTouchStart = (e) => {
    setTouchStart(e.targetTouches[0].clientX);
  };
  const handleTouchMove = (e) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };
  const handleTouchEnd = (e) => {
    if (touchStart - touchEnd > 200) {
      //console.log("right");
    } else if (touchStart - touchEnd < -200) {
      setToggleSideNav((p) => p + 1);
      //console.log("left");
    }
  };

  return (
    <div className="overflow-x-hidden overflow-y-auto ">
      <Head>
        <title>
          {query?.slug?.[0] ? `troddit · ${query?.slug?.[0]}` : "troddit"}
        </title>
      </Head>
      <main
        onTouchStart={(e) => handleTouchStart(e)}
        onTouchMove={(e) => handleTouchMove(e)}
        onTouchEnd={(e) => handleTouchEnd(e)}
      >
        <NavBar toggleSideNav={toggleSideNav} />
        {loaded && <Feed query={feedQuery} isUser={isUser} />}
      </main>
    </div>
  );
};

Sort.getInitialProps = ({ query }) => {
  return { query };
};

export default Sort;
