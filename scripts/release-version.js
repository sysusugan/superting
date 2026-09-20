const TIME_ZONE = "Asia/Shanghai";

function timestampVersion(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map(({ type, value }) => [type, value])
  );
  return `${Number(parts.year) % 100}.${Number(parts.month) * 100 + Number(parts.day)}.${Number(parts.hour) * 100 + Number(parts.minute)}`;
}

function validateReleaseVersion(version) {
  if (typeof version !== "string" || !/^[1-9]\d\.[1-9]\d{2,3}\.(0|[1-9]\d{0,3})$/.test(version)) {
    throw new Error("Release version must be YY.MDD.HMM, e.g. 26.915.1347 (Asia/Shanghai)");
  }
  const [year, monthDay, hourMinute] = version.split(".").map(Number);
  const month = Math.floor(monthDay / 100),
    day = monthDay % 100;
  const date = new Date(Date.UTC(2000 + year, month - 1, day));
  if (
    date.getUTCFullYear() !== 2000 + year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    Math.floor(hourMinute / 100) > 23 ||
    hourMinute % 100 > 59
  ) {
    throw new Error(`Invalid release date/time: ${version}`);
  }
  return version;
}

function getReleaseVersion(env = process.env, now = new Date()) {
  const tag = env.GITHUB_REF_TYPE === "tag" ? env.GITHUB_REF_NAME?.replace(/^v/, "") : undefined;
  return validateReleaseVersion(env.SUPERTING_RELEASE_VERSION || tag || timestampVersion(now));
}

if (require.main === module) console.log(getReleaseVersion());
module.exports = { timestampVersion, validateReleaseVersion, getReleaseVersion };
