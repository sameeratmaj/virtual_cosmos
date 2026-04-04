export function getDistance(firstPlayer, secondPlayer) {
  return Math.sqrt(
    (secondPlayer.x - firstPlayer.x) ** 2 + (secondPlayer.y - firstPlayer.y) ** 2
  );
}
