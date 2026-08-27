import {Composition} from 'remotion';
import {Benchmark} from './Benchmark';

export const RemotionRoot = () => (
  <Composition
    id="NorthstarBenchmark"
    component={Benchmark}
    durationInFrames={360}
    fps={30}
    width={1920}
    height={1080}
  />
);
