const express = require("express");
const multer = require("multer");
const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
const ffmpeg = require("fluent-ffmpeg");
const path = require("path");
const cors = require("cors");
const axios = require("axios");
// const fs = require("fs");
const fs = require('@cyclic.sh/s3fs')(process.env.S3_BUCKET_NAME)

const HEART_IMAGE_PATH = "./heart.png";

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

  ffmpeg()
    .input(inputVideo)
    .input(overlayImage)
    .complexFilter([
      {
        filter: "scale",
        options: "2048:2732", // Resize the video to 2048x2732
        outputs: "scaled_video",
      },
      {
        filter: "overlay",
        options: { x: 0, y: "H-h" }, // Overlay at the bottom (0, H-h)
        inputs: "scaled_video",
      },
    ])
    .output(outputVideo)
    .on("end", async () => {
      //upload to cloudinary
      const formData = new FormData();

      const outputVideoBuffer = fs.readFileSync(outputVideo);
      const blob = new Blob([outputVideoBuffer]);

      formData.append("file", blob);
      formData.append("upload_preset", "q1gh8rnp");

      try {
        const { data } = await axios({
          method: "post",
          url: "https://api.cloudinary.com/v1_1/daxr7lj1c/video/upload",
          data: formData,
        });
        const url = data.url.replace(
          "upload/",
          "upload/f_gif/e_boomerang/e_loop/"
        );

        axios.get(url);

        fs.unlinkSync(outputVideo);
        fs.unlinkSync(inputVideo);

        res.status(200).send({ url });
      } catch (error) {
        fs.unlinkSync(outputVideo);
        fs.unlinkSync(inputVideo);

        console.log("error", error);
        res.status(500).send("Video processing error.");
      }
    })
    .on("error", (err) => {
      console.error("Error:", err);
      res.status(500).send("Video processing error.");
    })
    .run();
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
