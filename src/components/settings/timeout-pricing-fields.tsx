import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface TimeoutPricingFieldsProps {
  requestTimeoutSec: string;
  onRequestTimeoutSecChange: (value: string) => void;
  inputPrice: string;
  onInputPriceChange: (value: string) => void;
  outputPrice: string;
  onOutputPriceChange: (value: string) => void;
}

export function TimeoutPricingFields({
  requestTimeoutSec,
  onRequestTimeoutSecChange,
  inputPrice,
  onInputPriceChange,
  outputPrice,
  onOutputPriceChange,
}: TimeoutPricingFieldsProps) {
  return (
    <>
      {/* Request Timeout */}
      <div className="space-y-2">
        <Label htmlFor="requestTimeoutSec">Request Timeout (seconds)</Label>
        <Input
          id="requestTimeoutSec"
          type="number"
          min="10"
          max="600"
          value={requestTimeoutSec}
          onChange={(e) => onRequestTimeoutSecChange(e.target.value)}
          placeholder="240"
        />
        <p className="text-caption text-muted-foreground">
          Request timeout (seconds) — raise for slow/free APIs; keep ≤270 on Vercel Hobby
        </p>
      </div>

      {/* Cost tracking prices */}
      <div className="space-y-2">
        <Label>Token Prices (USD per 1M tokens, optional)</Label>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Input
              id="inputPrice"
              type="number"
              min="0"
              step="any"
              value={inputPrice}
              onChange={(e) => onInputPriceChange(e.target.value)}
              placeholder="Input, e.g. 0.075"
            />
            <p className="text-caption text-muted-foreground">Input / prompt</p>
          </div>
          <div className="space-y-1.5">
            <Input
              id="outputPrice"
              type="number"
              min="0"
              step="any"
              value={outputPrice}
              onChange={(e) => onOutputPriceChange(e.target.value)}
              placeholder="Output, e.g. 0.30"
            />
            <p className="text-caption text-muted-foreground">Output / completion</p>
          </div>
        </div>
        <p className="text-caption text-muted-foreground">
          Used to show per-chapter translation cost on the novel page. Leave blank to track tokens
          only.
        </p>
      </div>
    </>
  );
}
