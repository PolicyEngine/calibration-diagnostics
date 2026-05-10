"use client";

import { SelectInput, Stack, Text } from "@policyengine/ui-kit";
import { useStates, useDistricts } from "@/lib/api/hooks/use-geography";
import { useEffect, useRef } from "react";
import type { GeoLevel, GeoFilter } from "@/lib/geo-context";

interface GeoSelectorProps {
  value: GeoFilter;
  onChange: (filter: GeoFilter) => void;
}

export function GeoSelector({ value, onChange }: GeoSelectorProps) {
  const states = useStates();
  const districts = useDistricts(value.stateFips);

  const stateOptions = (states.data ?? []).map((s) => ({
    label: s.name,
    value: String(s.fips),
  }));

  const districtOptions = (districts.data ?? []).map((d) => ({
    label: d.name,
    value: String(d.cd_geoid),
  }));

  // Auto-select the first district when districts load and we're in district mode
  const prevDistrictsRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const key = `${value.stateFips}-${districts.data?.length}`;
    if (
      value.level === "district" &&
      !value.cdGeoid &&
      districts.data &&
      districts.data.length > 0 &&
      prevDistrictsRef.current !== key
    ) {
      prevDistrictsRef.current = key;
      const first = districts.data[0];
      onChange({ ...value, cdGeoid: first.cd_geoid, label: first.name });
    }
  }, [value, districts.data, onChange]);

  return (
    <Stack gap="xs">
      <div>
        <Text size="xs" c="dimmed">Geography</Text>
        <SelectInput
          value={value.level}
          onChange={(val: string) => {
            const level = val as GeoLevel;
            if (level === "national") {
              onChange({ level, label: "National" });
            } else if (level === "state") {
              const first = states.data?.[0];
              const fips = first?.fips ?? 1;
              const name = first?.name ?? "Alabama";
              onChange({ level, stateFips: fips, label: name });
            } else {
              const firstState = states.data?.[0];
              const fips = firstState?.fips ?? 1;
              const name = firstState?.name ?? "Alabama";
              onChange({ level, stateFips: fips, cdGeoid: undefined, label: name });
            }
          }}
          options={[
            { label: "National", value: "national" },
            { label: "State", value: "state" },
            { label: "Congressional district", value: "district" },
          ]}
        />
      </div>
      {value.level !== "national" && (
        <div>
          <Text size="xs" c="dimmed">State</Text>
          <SelectInput
            value={value.stateFips ? String(value.stateFips) : ""}
            onChange={(val: string) => {
              if (val) {
                const fips = Number(val);
                const name = states.data?.find((s) => s.fips === fips)?.name ?? "";
                if (value.level === "district") {
                  onChange({ level: "district", stateFips: fips, cdGeoid: undefined, label: name });
                } else {
                  onChange({ level: "state", stateFips: fips, label: name });
                }
              }
            }}
            options={stateOptions}
          />
        </div>
      )}
      {value.level === "district" && value.stateFips && districtOptions.length > 0 && (
        <div>
          <Text size="xs" c="dimmed">District</Text>
          <SelectInput
            value={value.cdGeoid ? String(value.cdGeoid) : ""}
            onChange={(val: string) => {
              if (val) {
                const cd = Number(val);
                const name = districts.data?.find((d) => d.cd_geoid === cd)?.name ?? "";
                onChange({ ...value, cdGeoid: cd, label: name });
              }
            }}
            options={districtOptions}
          />
        </div>
      )}
    </Stack>
  );
}
