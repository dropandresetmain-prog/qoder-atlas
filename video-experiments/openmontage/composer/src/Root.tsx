import { Composition } from "remotion";
import { NorthstarBenchmark } from "./NorthstarBenchmark";
import { DURATION_FRAMES, FPS } from "./theme";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="NorthstarBenchmark"
        component={NorthstarBenchmark}
        durationInFrames={DURATION_FRAMES}
        fps={FPS}
        width={1920}
        height={1080}
      />
    </>
  );
};
