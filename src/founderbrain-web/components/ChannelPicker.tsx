import {
  CONTENT_CHANNELS,
  parseContentChannels,
  toggleContentChannel,
  type ContentChannel,
} from "../../founderbrain-shared/channels.ts";

export function ChannelPicker({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (next: string) => void;
}) {
  const selected = parseContentChannels(value);
  function toggle(channel: ContentChannel) {
    onChange(toggleContentChannel(value, channel));
  }
  return (
    <div className="channel-picker">
      <p className="entry-lede typeform-lede">
        Select the channels this pack is for. The 30 pieces are written only for these. Nothing is added for a channel you leave off.
      </p>
      <div className="typeform-choices channel-choices">
        {CONTENT_CHANNELS.map((channel) => {
          const on = selected.includes(channel);
          return (
            <button
              key={channel}
              type="button"
              className={on ? "typeform-choice picked" : "typeform-choice"}
              aria-pressed={on}
              disabled={disabled}
              onClick={() => toggle(channel)}
            >
              {channel}
            </button>
          );
        })}
      </div>
      {selected.length ? (
        <p className="channel-picked">Selected: {selected.join(", ")}</p>
      ) : (
        <p className="entry-error" role="status">
          Select at least one channel before generating.
        </p>
      )}
    </div>
  );
}
