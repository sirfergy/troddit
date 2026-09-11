import { useSession } from "next-auth/react";
import React, { useEffect, useState } from "react";
import { BiHide } from "react-icons/bi";
import { VscEye, VscEyeClosed } from "react-icons/vsc";
import useMutate from "../hooks/useMutate";
import { useMainContext } from "../MainContext";
import { useIsMutating, useQueryClient } from "@tanstack/react-query";
import { postActionKey } from "../../lib/feedActions";

const HideButton = ({
  id,
  hidden,
  post = false,
  isPortrait = false,
  row = false,
  category = "",
  postindex = undefined,
  menu = false,
}) => {
  const { data: session, status } = useSession();
  const loading = status === "loading";
  const context: any = useMainContext();
  const [isHidden, setIsHidden] = useState(false);
  useEffect(() => {
    setIsHidden(!!hidden);
  }, [hidden, id]);

  const { hideMutation } = useMutate(id);
  const queryClient = useQueryClient();
  const mutationKey = postActionKey("hide", id);
  const pending = useIsMutating({ mutationKey }) > 0;

  useEffect(() => {
    if (hideMutation.isError) setIsHidden(!!hidden);
  }, [hideMutation.isError, hidden, id]);

  const hide = async () => {
    if (queryClient.isMutating({ mutationKey })) return;
    if (session) {
      setIsHidden((s) => !s);
      hideMutation.mutate({ id: id, isHidden: isHidden });
    } else if (!loading) {
      context.toggleLoginModal(true);
    }
  };

  const eyeStyle =
    "flex-none   " +
    (row || menu ? " w-4 h-4 " : " w-6 h-6 ") +
    (!isPortrait && !row ? " md:mr-2 " : " ") +
    (menu ? " mr-2 " : "") +
    (isHidden ? " text-th-red" : " ");

  return (
    <button
      type="button"
      disabled={pending}
      aria-label={isHidden ? "unhide" : "hide"}
      className={
        "flex flex-row items-center disabled:opacity-50 disabled:cursor-wait " +
        (menu ? " pr-4 pl-2 py-2.5 md:py-1 " : " space-x-1 ")
      }
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        hide();
      }}
    >
      {(post || row || menu) && (
        <>
          {isHidden ? (
            <VscEyeClosed className={eyeStyle + (" mt-0.5")} />
          ) : (
            <VscEye className={eyeStyle} />
          )}
        </>
      )}

      {!isPortrait && (
        <span className={(post ? "hidden " : "") + (!isPortrait && !row ? " md:block " : "") + (row ? "hidden sm:block " : "")}>
          {isHidden ? "Unhide" : "Hide"}
          {menu ? " Post" : ""}
        </span>
      )}
    </button>
  );
};

export default HideButton;
