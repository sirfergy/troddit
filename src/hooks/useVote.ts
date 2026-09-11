import React, { useEffect, useMemo, useState } from "react";
import useMutate from "./useMutate";
import { useIsMutating, useQueryClient } from "@tanstack/react-query";
import { postActionKey, voteValue } from "../../lib/feedActions";
import type { VoteValue } from "../../lib/feedActions";
interface VoteArgs {
  name: string;
  likes: number | boolean;
  score: number;
  scoreHideMins?: number;
  postTime?: number;
}

const calculateScore = (x: number) => {
  if (x < 1000) {
    return x.toString();
  } else {
    let y = Math.floor(x / 1000);
    let z = (x / 1000).toFixed(1);
    return z.toString() + "k";
  }
};

const useVote = ({ name, likes, score, postTime, scoreHideMins }: VoteArgs) => {
  const { voteMutation } = useMutate(name);
  const queryClient = useQueryClient();
  const mutationKey = postActionKey("vote", name);
  const pending = useIsMutating({ mutationKey }) > 0;
  const [voteScore, setVoteScore] = useState<number>(score);
  const [liked, setLiked] = useState<VoteValue>(() => voteValue(likes));

  const voteDisplay = useMemo(() => {
    let display = calculateScore(voteScore) ?? "0";
    if (scoreHideMins && postTime && scoreHideMins > 0 && postTime > 0) {
      const now = new Date().getTime() / 1000;
      if (postTime + scoreHideMins * 60 > now) {
        display = "Vote";
      }
    }
    return display;
  }, [voteScore, postTime, scoreHideMins]);

  useEffect(() => {
    setLiked(voteValue(likes));
    setVoteScore(score);
  }, [name, likes, score]);

  useEffect(() => {
    if (voteMutation.isError) {
      setLiked(voteValue(likes));
      setVoteScore(score);
    }
  }, [voteMutation.isError, name, likes, score]);

  const castVote = async (v: -1 | 1) => {
    if (queryClient.isMutating({ mutationKey })) return;
    const postv = v === liked ? 0 : v;
    const increment = postv - liked;
    setLiked(postv);
    setVoteScore((v) => v + increment);
    voteMutation.mutate({ vote: postv, id: name, increment: increment });
  };

  return {
    voteDisplay,
    castVote,
    liked,
    loading: pending,
  };
};

export default useVote;
