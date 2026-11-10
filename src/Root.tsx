import React from "react";
import { Composition } from "remotion";
import {
  FacelessVideo,
  FPS,
  calculateMetadata,
  defaultVideoProps,
  VideoProps,
} from "./Composition";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="FacelessVideo"
      component={FacelessVideo}
      durationInFrames={90} // placeholder, overwritten by calculateMetadata
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={defaultVideoProps satisfies VideoProps}
      calculateMetadata={calculateMetadata}
    />
  );
};