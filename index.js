// 1. Roll the dice for both players
var randomNumber1 = Math.floor(Math.random() * 6) + 1; // Generates 1-6
var randomNumber2 = Math.floor(Math.random() * 6) + 1; // Generates 1-6

// 2. Create the file path strings for the images
var randomImageSource1 = "images/dice" + randomNumber1 + ".png"; // e.g., images/dice3.png
var randomImageSource2 = "images/dice" + randomNumber2 + ".png"; // e.g., images/dice3.png

// 3. Simple check: Is this the first time opening or a refresh?
// Type 1 means the page was reloaded/refreshed
if (performance.navigation.type === 1) {

    // Change the 'src' attribute of the images using querySelector
    document.querySelector(".img1").setAttribute("src", randomImageSource1);
    document.querySelector(".img2").setAttribute("src", randomImageSource2);

    // Determine the winner and update the H1 text and font size
    if (randomNumber1 > randomNumber2) {
        document.querySelector("h1").innerHTML = "🚩 Abebe Won!";
        //document.querySelector("h1").style.fontSize = "3rem";
    } 
    else if (randomNumber2 > randomNumber1) {
        document.querySelector("h1").innerHTML = "Chala Won! 🚩";
        //document.querySelector("h1").style.fontSize = "3rem";
    } 
    else {
        document.querySelector("h1").innerHTML = "It's a Draw!";
        //document.querySelector("h1").style.fontSize = "3rem";
    }

} else {
    // This runs ONLY the first time the page is opened, keeping your HTML's "Refresh Me"
    document.querySelector("h1").innerHTML = "Refresh Me";
}