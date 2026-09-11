import { useSession } from "next-auth/react";
import React, { useEffect, useState } from "react";
import { BsBookmarks, BsBookmarksFill } from "react-icons/bs";
import { useKeyPress } from "../hooks/KeyPress";
import useMutate from "../hooks/useMutate";
import { useMainContext } from "../MainContext";
import { useIsMutating, useQueryClient } from "@tanstack/react-query";
import { postActionKey } from "../../lib/feedActions";
const SaveButton = ({
  id,
  saved,
  useKeys = false,
  post = false,
  isPortrait = false,
  row = false,
  fullmedia = false,
  category = "",
  children = <></>,
  menu = false,
}) => {
  const { data: session, status } = useSession();
  const loading = status === "loading";
  const context: any = useMainContext();
  const [isSaved, setIsSaved] = useState(false);
  const aPress = useKeyPress("s");

  useEffect(() => {
    setIsSaved(!!saved);
  }, [saved, id]);

  const { saveMutation } = useMutate(id);
  const queryClient = useQueryClient();
  const mutationKey = postActionKey("save", id);
  const pending = useIsMutating({ mutationKey }) > 0;

  useEffect(() => {
    if (saveMutation.isError) setIsSaved(!!saved);
  }, [saveMutation.isError, saved, id]);

  const save = async () => {
    if (queryClient.isMutating({ mutationKey })) return;
    if (session) {
      setIsSaved((s) => !s);
      saveMutation.mutate({ id: id, isSaved: isSaved });
    } else if (!loading) {
      context.toggleLoginModal(true);
    }
  };

  useEffect(() => {
    if (!context.replyFocus && useKeys) {
      if (aPress) {
        save();
      }
    }

    return () => {};
  }, [aPress, context.replyFocus]);

  const bookmarkStyle =
    "flex-none   " +
    (row || menu || fullmedia ? " w-4 h-4 " : " w-5 h-5 ") +
    (!isPortrait && !row ? " md:mr-2 " : " ") +
    (menu ? " mr-2 " : "") +
    (isSaved ? " text-th-upvote " : " ");

  return (
    <button
      type="button"
      disabled={pending}
      title={`save ${useKeys ? "(s)" : ""}`}
      aria-label="save"
      className={
        "flex flex-row items-center outline-none disabled:opacity-50 disabled:cursor-wait " +
        (menu
          ? " pl-2 pr-4 py-2.5  md:py-1 w-full "
          : row
          ? " px-3 sm:px-2 py-1 h-8 sm:h-[26px] space-x-1 border border-transparent rounded-md hover:border-th-borderHighlight hover:cursor-pointer w-full "
          : post
          ? " cursor-pointer p-2  border rounded-md border-th-border hover:border-th-borderHighlight w-full "
          : fullmedia
          ? " w-10 h-10 flex-none bg-black/40 backdrop-blur-lg rounded-full justify-center text-white"
          : " space-x-1 w-full ") +
        (isSaved ? "" : " hover:text-th-upvote ")
      }
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        save();
      }}
    >
      {(post || row || menu || fullmedia) && (
        <>
          {!!isSaved ? (
            <BsBookmarksFill className={bookmarkStyle} />
          ) : (
            <BsBookmarks className={bookmarkStyle} />
          )}
        </>
      )}

      {!isPortrait && !fullmedia && (
        <span
          className={
            (post ? "hidden " : "") +
            (!isPortrait && !row ? " md:block " : "") +
            (row ? " hidden sm:block " : "")
          }
        >
          {isSaved ? "Unsave" : "Save"}
          {menu ? " Post" : ""}
        </span>
      )}
    </button>
  );
};

export default SaveButton;
