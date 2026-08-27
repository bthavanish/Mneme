# Mneme  Pattern Detection with Computer Vision

<img width="1920" alt="Mneme camera detection interface" src="https://github.com/user-attachments/assets/fdfa94fb-5915-4536-aecd-4d842204795d" />

Mneme is my school project about pattern detection using computer vision. It turns a normal phone or laptop camera into a small local AI detector: it can spot common objects, draw boxes around them, and try to recognise people or objects that you save as samples.

The idea is simple: a computer looks at camera frames, searches for visual patterns it learned before, and gives the result a name. Everything is designed to run in the browser, so the camera feed and saved samples stay on the device.

## What you can do with it

- Use **General** mode to detect common things such as people, bottles, cups, phones, cars, animals, books, and many more.
- See a bounding box, label, and confidence score over each detected object.
- Save a person or object in the **Memory** tab using one or more camera photos.
- Use **Sample** mode to look for saved people and for object classes learned from saved object samples.
- Review detections in the sidebar log.
- Choose a detector model and tune the detection speed, confidence, and number of boxes.
- Keep models and samples locally in browser storage after the first download.

## Try it

Website: [bthavanish.github.io/Mneme](https://bthavanish.github.io/Mneme/)

Or run it yourself. You need Node.js 18 or newer, a camera, and a modern browser.

```bash
npm install
npm run dev
```

Open the address Vite prints in the terminal and allow camera access.

To try it from a phone on the same Wi-Fi network:

```bash
npm run dev -- --host 0.0.0.0
```

Then open `http://<your-computer-ip>:5173/Mneme/` on the phone.

## How to use Mneme

### General mode

1. Open the app and allow camera access.
2. Leave **General** turned on.
3. Point the camera at an object.
4. Mneme draws a box around it and writes something like `bottle 87%`.

For example, if you point the camera at a backpack and a person, it may draw two boxes: one labelled `backpack` and another labelled `person`. The percentage is how confident the model is, not a guarantee that it is right.

### Saving a sample

1. Open the **Memory** tab.
2. Press the `+` button.
3. Choose **Person** or **Object**.
4. Take one or more clear photos and give the sample a name.

For a person, take photos where the face is clear, reasonably close, and facing the camera. For an object, keep the object large and well lit in the frame. More good samples usually work better than one blurry photo.

### Sample mode

Turn on **Sample** after saving something. The app prepares the saved photos in the background, then checks new camera frames against them.

- A saved person is compared using a face descriptor: a small list of numbers made from facial features.
- A saved object is first linked to a general object class, such as `bottle` or `cup`. When that class appears in the camera, Mneme shows the name you saved.

For example, if you save a water bottle and name it `My bottle`, Sample mode can label a later `bottle` detection as `My bottle` and place it in the log.

## Settings

The settings panel has controls for both accuracy and performance.

| Control | What it changes |
| --- | --- |
| Show confidence scores | Shows or hides the percentage on detection boxes. |
| Mirror camera | Flips the preview like a selfie camera. |
| Detection threshold | Higher values show fewer, more confident object results. |
| Face match distance | Lower values make person matching stricter; higher values make it more forgiving. |
| Maximum boxes per frame | Limits how many objects can be drawn at one time. |
| Inference speed | Battery Saver uses fewer checks, Balanced is the default, and Responsive checks more often. |
| Object model | Lets you choose between faster and more accurate COCO-SSD model versions. |
| Reindex samples | Re-processes old saved images if a model update or earlier failed attempt left them unprepared. |
| Local data controls | Clear logs, saved samples, face data, or downloaded models. |

## How the app works  explained normally

This is the full explanation of the computer-vision part of the project. You do not need to know programming to understand the basic idea.

### 1. Video is lots of pictures

Video is not one magical moving image. It is lots of still pictures shown quickly, called frames. Mneme takes a frame from the camera every short moment and gives it to an AI model.

It does not send the frame to a person or a website for someone to inspect. The calculation happens in the browser on the device’s graphics hardware when possible.

### 2. General detection looks for learned visual patterns

The General model is called COCO-SSD. It was trained before this project using a very large set of labelled images. During training, it saw examples of objects such as people, chairs, dogs, bottles, buses, and keyboards.

When it sees a new camera frame, it does not “understand” the scene like a human. It compares visual patternsedges, colours, shapes, and combinations of those shapesto patterns it learned during training.

If the patterns look enough like a bottle, it returns three useful things:

```text
class: bottle
confidence: 0.87
box: [x position, y position, width, height]
```

Mneme turns that into the visible box and label. This is why the app can detect a bottle it has never physically seen before: the model was already trained on the general class `bottle`.

### 3. A box tells us where the pattern was found

The rectangle is called a **bounding box**. It tells the app where it thinks the object is in the camera frame.

If a camera frame is 1280 pixels wide and the model says a cup starts 300 pixels from the left, Mneme converts that location to the size of the displayed camera preview and draws the box in the matching place. The boxes are also smoothed slightly so they do not shake around too much.

### 4. Sample mode adds personal memory

General detection can say “this is a person” or “this is a cup,” but it does not know your friend’s name or which bottle is yours. Sample mode gives the app a small local memory created from the photos you save.

For objects, Mneme analyses the saved photo with the general detector. If it sees a `bottle` in the sample named `My bottle`, it remembers that relationship locally. Later, a camera detection of that class can be shown with the name `My bottle`.

This works best for clear common objects. If the general model cannot recognise the object in the sample photo, there is no reliable class to connect it to yet.

### 5. People need face recognition, not just “person” detection

A general object detector can draw a box around a person, but it cannot reliably say whether that person is Alex, Sam, or somebody else. To do that, Mneme uses a face-recognition model.

When you save a person photo, the app first finds the face. Then it converts the face into 128 numbers called a **face descriptor**. Think of it as a mathematical fingerprint made from visible face features, not a normal image file.

When a face appears in the camera, Mneme creates another descriptor and measures how close it is to the saved one.

```text
saved face descriptor  <---- compare distance ---->  camera face descriptor
```

If the distance is small enough, it uses the saved name. If it is not close enough, the result stays `Unknown`. This is why clear sample photos matter a lot: a dark, blurry, sideways, or covered face gives the model less useful information.

### 6. The detection log is a history, not another model

Whenever Mneme finds an object or recognised face, it creates a log entry with the label, time, confidence when available, and sometimes a tiny cropped preview. It avoids adding the same label again every instant so the log stays readable.

### 7. Why there are performance settings

AI detection takes computing power. Running it on every single video frame would make many phones hot, slow, or laggy. Mneme uses a scheduler that spaces out checks and adapts based on how long they take.

- **Battery Saver** waits longer between checks.
- **Balanced** is meant for normal use.
- **Responsive** checks more frequently, which can look smoother but needs more power.

The app also limits the number of boxes and lets you choose lighter or more accurate object models. This is a trade-off: faster models usually miss more details, while bigger models can be more accurate but slower.

## Privacy and storage

Mneme is made to be local-first.

- Camera frames are processed in the browser.
- Saved samples, descriptors, and downloaded model files are stored in the browser’s local IndexedDB storage.
- The app asks before enabling face memory.
- You can delete saved samples, face data, or models from Settings.

The first model download can require an internet connection. After the files are saved, normal use should not need to download them again unless you clear local model data.

## Technical summary

- Vite + vanilla TypeScript
- TensorFlow.js for browser-based machine learning
- COCO-SSD for general object detection
- vladmandic/face-api for face detection and descriptors
- IndexedDB and localStorage for local state
- Canvas overlays for boxes and labels

## Project structure

```text
src/
  lib/         camera, models, storage, scheduler, face/object detection
  ui/          canvas boxes, toasts, detection history, navigation
  styles/      layout, visual tokens, animations
  main.ts      app setup and user interactions
public/models/ face model files bundled with the app
```

## Build and deploy

```bash
npm run build
npm run preview -- --host 0.0.0.0
```

The production files are placed in `dist/`. GitHub Actions deploys the project to GitHub Pages when changes are pushed to `main`.

## License

Apache-2.0
