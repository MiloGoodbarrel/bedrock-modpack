// Tests for behavior_packs/modpack_bp/scripts/hand.js (pure JS, no Minecraft).
// Run with Node 18+:  node tests/hand.test.js   (or in a browser via tests/run.html)

export function runHandTests(h) {
  const fails = [];
  const check = (name, ok) => {
    if (!ok) fails.push(name);
  };
  const SIZE = 5;
  let n = 0;
  const time = (m) => ({ id: `t${n++}`, type: "time", minutes: m });
  const cancel = () => ({ id: `c${n++}`, type: "cancel" });
  const value = (c) => (c.type === "time" ? c.minutes * 10 : 45);

  // Filling up to five works; the sixth needs a discard.
  {
    const hand = [];
    const offer = h.mergeOffer(null, "o1", [time(3), time(3), time(3), time(3), time(3), time(10)], 6);
    for (let i = 0; i < 5; i++) check(`take ${i + 1}`, h.takeCard(hand, offer, offer.cards[0].id, undefined, SIZE).ok);
    const tenId = offer.cards[0].id;
    const r = h.takeCard(hand, offer, tenId, undefined, SIZE);
    check("sixth card without discard is refused", !r.ok && r.reason === "hand-full");
    check("hand still 5 after refusal", hand.length === 5);
    check("bonus counts at most 5 cards", h.bonusSeconds(hand, SIZE) === 15 * 60);
    const swap = h.takeCard(hand, offer, tenId, hand[0].id, SIZE);
    check("swap with discard works", swap.ok && hand.length === 5);
    check("swap updates bonus", h.bonusSeconds(hand, SIZE) === (12 + 10) * 60);
    check("offer done after last pick", swap.offerDone);
  }

  // Declining the offered card when full uses a pick and keeps the hand.
  {
    const hand = [time(3), time(3), time(3), time(3), time(3)];
    const offer = h.mergeOffer(null, "o2", [cancel(), time(5)], 1);
    const id = offer.cards[0].id;
    const r = h.takeCard(hand, offer, id, id, SIZE);
    check("decline ok", r.ok && r.offerDone && hand.length === 5 && !hand.some((c) => c.id === id));
  }

  // Bad inputs never change anything.
  {
    const hand = [time(3)];
    const offer = h.mergeOffer(null, "o3", [time(5)], 1);
    check("unknown card refused", !h.takeCard(hand, offer, "nope", undefined, SIZE).ok && hand.length === 1);
    const full = [time(3), time(3), time(3), time(3), time(3)];
    check("bad discard refused", !h.takeCard(full, offer, offer.cards[0].id, "nope", SIZE).ok && full.length === 5);
    check("no picks left refused", !h.takeCard(hand, { cards: [time(3)], picks: 0 }, "x", undefined, SIZE).ok);
    check("null offer refused", !h.takeCard(hand, null, "x", undefined, SIZE).ok);
  }

  // Merging offers keeps both sets of cards and adds the picks (distance draws 2 picks 2, twice -> 4/4).
  {
    const o = h.mergeOffer(null, "o4", [time(3), time(5)], 2);
    h.mergeOffer(o, "o5", [time(3), cancel()], 2);
    check("merged offer has 4 cards and 4 picks", o.cards.length === 4 && o.picks === 4);
  }

  // autoFinish never exceeds the cap and prefers valuable cards.
  {
    const hand = [time(3), time(3), time(3), time(3), time(3)];
    const offer = h.mergeOffer(null, "o6", [time(10), time(5), time(3)], 2);
    h.autoFinish(hand, offer, SIZE, value);
    check("autoFinish keeps 5", hand.length === 5);
    check("autoFinish swapped in the 10 and 5", h.bonusSeconds(hand, SIZE) === (10 + 5 + 3 + 3 + 3) * 60);
    const small = [];
    h.autoFinish(small, h.mergeOffer(null, "o7", [time(3), time(10), cancel()], 1), SIZE, value);
    check("autoFinish picks the most valuable", small.length === 1 && small[0].minutes === 10);
  }

  // Old oversized hands get repaired.
  {
    const hand = [time(3), time(10), time(3), time(5), time(3), time(3), time(3)];
    h.trim(hand, SIZE, value);
    check("trim to 5 keeps the best", hand.length === 5 && h.bonusSeconds(hand, SIZE) === (10 + 5 + 3 + 3 + 3) * 60);
  }

  // Randomized: any sequence of takes/discards keeps the hand within the cap.
  {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let t = 0; t < 300; t++) {
      const hand = [];
      let offer = null;
      for (let step = 0; step < 40; step++) {
        if (!offer || rand() < 0.3) offer = h.mergeOffer(offer, `o${t}-${step}`, [time(3), time(5), cancel()], 1 + Math.floor(rand() * 2));
        const card = offer.cards[Math.floor(rand() * offer.cards.length)];
        if (!card) {
          offer = null;
          continue;
        }
        const discard = rand() < 0.5 ? hand[Math.floor(rand() * hand.length)]?.id : rand() < 0.5 ? card.id : undefined;
        const r = h.takeCard(hand, offer, card.id, discard, SIZE);
        if (r.ok && r.offerDone) offer = null;
        if (hand.length > SIZE) {
          fails.push("random sequence exceeded the cap");
          break;
        }
      }
    }
  }

  return { passed: fails.length === 0, fails: [...new Set(fails)].slice(0, 10) };
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("hand.test.js")) {
  const h = await import("../behavior_packs/modpack_bp/scripts/hand.js");
  const res = runHandTests(h);
  console.log(res.passed ? "hand: all tests passed" : `hand: FAILED\n${res.fails.join("\n")}`);
  process.exit(res.passed ? 0 : 1);
}
