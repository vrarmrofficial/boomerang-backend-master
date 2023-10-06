const express = require("express");
const multer = require("multer");
const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
const ffmpeg = require("fluent-ffmpeg");
const path = require("path");
const cors = require("cors");
const axios = require("axios");
const fs = require("fs");
const AWS = require('aws-sdk');
require('dotenv').config();

const s3 = new AWS.S3({
  accessKeyId: process.env.ACCESS_KEY_ID,
  secretAccessKey: process.env.SECRET_ACCESS_KEY
});

const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;

// const HEART_IMAGE_PATH = "./heart.png";
const HEART_IMAGE_PATH = "./heart_scaled_down.png";

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const port = process.env.port || 3000;

app.use(cors());

// Set up storage for uploaded files
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});
const upload = multer({ storage });

app.get("/", (req, res) => {
  res.status(200).send("Server is up and running!");
});

app.post("/processVideo", upload.single("video"), (req, res) => {
  if (!req.file) {
    return res.status(400).send("No file uploaded.");
  }

  const inputVideo = path.join(__dirname, "uploads", req.file.originalname);
  const overlayImage = HEART_IMAGE_PATH; // Path to the overlay image
  const outputVideo = `./outputs/${Date.now()}-output.mp4`; // Path to the output video
  const outputGifName = `${Date.now()}-output.gif`;
  const outputGif = `./outputs/${outputGifName}`;

  const convertToGif = () => {
    ffmpeg()
      .input(outputVideo)
      .complexFilter('[0]reverse[r];[0][r]concat=n=2:v=1:a=0[v]')
      .map('[v]')
      .output(outputGif)
      .on('end', () => {
        const outputGifBuffer = fs.readFileSync(outputGif);

        try {
          s3.upload({
            Bucket: S3_BUCKET_NAME,
            Key: outputGifName,
            Body: outputGifBuffer,
            ACL: 'public-read'
          }, (err, data) => {
            if (err) {
              console.error(err);

              fs.unlinkSync(outputGif);
              fs.unlinkSync(outputVideo);
              fs.unlinkSync(inputVideo);

              console.log("error", err);
              res.status(500).send("Video processing error.");
            } else {
              fs.unlinkSync(outputGif);
              fs.unlinkSync(outputVideo);
              fs.unlinkSync(inputVideo);

              res.status(200).send({ url: data.Location });
            }
          });
        } catch (err) {
          console.error(err);

          fs.unlinkSync(outputGif);
          fs.unlinkSync(outputVideo);
          fs.unlinkSync(inputVideo);

          console.log("error", err);
          res.status(500).send("Video processing error.");
        }
      })
      .on('error', (err) => {
        fs.unlinkSync(outputVideo);
        fs.unlinkSync(inputVideo);
        console.error('Error (Conversion to GIF):', err);
      })
      .run();
  }

  const addHeartFrameToVideo = () => {
    ffmpeg()
      .input(inputVideo)
      .input(overlayImage)
      .complexFilter([
        {
          filter: "scale",
          options: "1024:1024", // Resize the video to 1024x1024
          outputs: "scaled_video",
        },
        {
          filter: "pad",
          options: "1024:1366:0:342", // Add padding to the top to fit the video at the bottom
          outputs: "padded_frame",
          inputs: "scaled_video",
        },
        {
          filter: "overlay",
          options: { x: 0, y: 0 }, // Overlay at the bottom (0, 342 pixels from the top)
          inputs: ["padded_frame", "1:v"], // Use "1:v" to reference the overlay image
        }
      ])
      .output(outputVideo)
      .on("end", () => {
        convertToGif();
      })
      .on("error", (err) => {
        fs.unlinkSync(inputVideo);
        console.error("Error:", err);
        res.status(500).send("Video processing error.");
      })
      .run();
  }

  addHeartFrameToVideo();
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});